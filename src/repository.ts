import * as config from '../database'
import {persistError} from './logger'
import {Pool, PoolClient, ClientBase} from 'pg'
import {env} from './environment'
import * as EthU from 'ethereumjs-util'
import {udefCoalesce, recoverEthAddressFromPersonalRpcSig} from './utils'

const pool = new Pool(
  env.nodeEnv() === 'production' ? config.production : config.development
)

pool.on('error', (err, client) => {
  persistError(err.message, err.stack!)
})

export interface IEntity {
  did: string
}

export default class Repo {
  public static async transaction<T>(callback: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await callback(client)
      await client.query('COMMIT')
      return result
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }

  public static async query<T>(
    callback: (client: PoolClient) => Promise<T>,
    client?: PoolClient
  ) {
    let newClient = false
    if (client === null || client === undefined) {
      client = await pool.connect()
      newClient = true
    }

    try {
      const result = await callback(client)
      return result
    } finally {
      if (newClient) {
        client.release()
      }
    }
  }

  public static async getDeletions(did: string, start: number, end?: number) {
    const result = await pool.query(
      `
        select data_id, signature
        from deletions
        where 1=1
          and id >= $2 and ($3::integer is null or id <= $3::integer)
          and did = $1::text
        order by id;
      `,
      [did, start, udefCoalesce(end, null)]
    )
    return result.rows as Array<{
      data_id: number
      signature: string
    }>
  }

  public static in(count: number, starting: number = 0) {
    let query = `(`
    const ids = [...Array(count).keys()].map(Number).map(i => i + starting)
    ids.forEach(id => {
      query += `$${id},`
    })
    return query.slice(0, -1) + ')'
  }

  public static values(types: string[], rowCount: number) {
    let query = ``
    const rows = [...Array(rowCount).keys()].map(Number)
    rows.forEach(row => {
      query += `(`
      types.forEach((type, i) => {
        query += `$${row * types.length + i + 1}::${type},`
      })
      query = query.slice(0, -1) + '),'
    })
    return query.slice(0, -1)
  }

  public static async deleteData(did: string, ids: number[], signatures: string[]) {
    return this.transaction(async client => {
      const newDeletions = await client.query(
        `update data set cyphertext = null where did = $1::text and cyphertext is not null and id in ${this.in(
          ids.length,
          2
        )} returning id;`,
        [did, ...ids]
      )

      const newCount = await client.query(
        `
          update entities set deleted_count = deleted_count + $2
          where did = $1::text
          returning deleted_count, data_count;`,
        [did, newDeletions.rowCount]
      )

      if (newDeletions.rowCount > 0) {
        const query = `
          insert into deletions
          (did,           id,        data_id,   signature) values ${this.values(
            ['text', 'integer', 'integer', 'text'],
            newDeletions.rowCount
          )};`

        const values = newDeletions.rows
          .map((row, i) => [
            did,
            newCount.rows[0].deleted_count - (newDeletions.rowCount - i),
            row.id,
            udefCoalesce(signatures[i], null),
          ])
          .reduce((v1, v2) => v1.concat(v2), [])

        await client.query(query, values)
      }

      return {
        deletedCount: newCount.rows[0].deleted_count as number,
        dataCount: newCount.rows[0].data_count as number,
      }
    })
  }

  public static async insertData({
    did,
    cyphertext,
    id,
    cypherindex,
  }: {
    did: string
    cyphertext: Buffer | Uint8Array
    id?: number
    cypherindex: Buffer | null
  }) {
    return this.transaction(async client => {
      const result = await client.query(
        `
          update entities set data_count = data_count + 1
          where did = $1::text and ($2::integer is null or data_count = $2::integer)
          returning data_count - 1 as id;
        `,
        [did, udefCoalesce(id, null)]
      )
      if (result.rowCount === 0) {
        return null
      }

      const newId = result.rows[0].id as number

      await client.query(
        `
          insert into data (
            did,
            id,
            cyphertext,
            cypherindex
          ) values (
            $1,
            $2,
            $3,
            $4
          );
        `,
        [did, newId, cyphertext, cypherindex]
      )
      return newId
    })
  }

  public static async getData({
    did,
    start,
    end,
    cypherindex,
  }: {
    did: string
    start: number
    end?: number
    cypherindex?: Buffer | null
  }) {
    try {
      const result = await pool.query(
        `
        select id, cyphertext
        from data
        where 1=1
          and id >= $2 and id <= coalesce($3::integer, $2)
          and did = $1::text
          and (coalesce($4, null) is null OR cypherindex = $4::bytea)
        order by id;
      `,
        [did, start, udefCoalesce(end, null), udefCoalesce(cypherindex, null)]
      )
      return result.rows as Array<{
        id: number
        cyphertext: Buffer | null
      }>
    } catch (err) {
      console.log({err})
      throw err
    }
  }

  public static async getEncryptedIndexes(did: string) {
    try {
      const result = await pool.query(
        `
        select cypherindex
        from data
        where 1=1
          and did = $1::text
          and cypherindex is not null
        order by id;
        `,
        [did]
      )
      return result.rows as Array<{cypherindex: Buffer}>
    } catch (err) {
      console.log({err})
      throw err
    }
  }

  public static async getMe(did: string) {
    const result = await pool.query(
      `select did, data_count, deleted_count from entities where did = $1::text;`,
      [did]
    )
    if (result.rowCount === 0) {
      throw new Error('could not find entity')
    }
    return result.rows[0] as {data_count: number; did: string; deleted_count: number}
  }

  public static async getEntity(
    token: string
  ): Promise<{did: string; blacklisted: boolean} | null> {
    const result = await pool.query(
      `
      select e.did, e.blacklisted
      from entities e
        join access_token a on e.did = a.did
      where a.uuid = $1;
    `,
      [token]
    )

    if (result.rowCount === 0) {
      return null
    }
    return result.rows[0]
  }

  public static async createAccessToken(did: string, initialize: boolean = false) {
    return this.transaction(async client => {
      if (initialize === true) {
        await client.query(
          `
          insert into entities
          (did, admin) select $1::text, true
          where (select count(*) from entities) = 0
        `,
          [did]
        )
      }

      const created = await client.query(
        `
        insert into entities
        (did) values ($1::text)
        on conflict(did) do nothing
        returning gen_random_uuid() as uuid;
      `,
        [did]
      )

      const allowAnonymous = env.allowAnonymous()

      if (created.rows.length > 0 && !allowAnonymous) {
        await client.query(`ROLLBACK;`)
        // return fake uuid to prevent attackers from
        // figuring out which keys exist in the database
        return created.rows[0].uuid as string
      }

      const token = await client.query(
        `
        insert into access_token (did) values ($1) returning uuid;
      `,
        [did]
      )

      return token.rows[0].uuid as string
    })
  }

  public static async validateAccessToken(token: string, signature: string) {
    const ethAddress = EthU.bufferToHex(
      recoverEthAddressFromPersonalRpcSig(token, signature)
    )

    return this.transaction(async client => {
      const result = await client.query(
        `
        update access_token set validated_at = now()
        where 1=1
          and uuid = $1
          and did = $2
          and validated_at is null
        returning did, date_part('epoch',now() + ($3 || ' seconds')::interval)::int as expires_at;
        `,
        [token, `did:ethr:${ethAddress}`, env.tokenExpirationSeconds()]
      )

      const row = result.rows[0] as {expires_at: number; did: string}
      if (!row) {
        return null
      }
      return row.expires_at
    })
  }

  public static async checkAccessToken(token: string) {
    const result = await pool.query(
      `
      select e.did
      from access_token at
        join entities e on e.did = at.did
      where 1=1
        and uuid = $1
        and validated_at between now() - ($2 || ' seconds')::interval and now()
        and e.blacklisted = false;
    `,
      [token, env.tokenExpirationSeconds()]
    )

    if (result.rowCount !== 1) {
      return null
    }
    return result.rows[0] as IEntity
  }

  public static async updateCallCount(ip: string, endpoint: string) {
    const result = await pool.query(
      `
    insert into "ip_call_count" as existing
    (ip   ,endpoint) values
    ($1  ,$2)
    on conflict(ip, endpoint) do update set
      count = case
        when
          existing.minute <> EXTRACT(MINUTE FROM current_timestamp)
          or current_timestamp - existing.updated_at > interval '1 minute'
        then 1
        else existing.count + 1
      end,
      minute = default,
      updated_at = default
    returning count;
    `,
      [ip, endpoint]
    )

    return result.rows[0].count as number
  }

  public static async addBlacklist(did: string) {
    return pool.query(
      `
      insert into entities
      (did, blacklisted) values ($1::text, true)
      on conflict(did) do update set blacklisted = true;
    `,
      [did]
    )
  }

  public static async removeBlacklist(did: string) {
    return pool.query(
      `
      update entities
      set blacklisted = false
      where did = $1::text;
    `,
      [did]
    )
  }

  public static async addAdmin(did: string) {
    return pool.query(
      `
      insert into entities
      (did, admin) values ($1::text, true)
      on conflict(did) do update set admin = true;
    `,
      [did]
    )
  }

  public static async removeAdmin(did: string) {
    return pool.query(
      `
      update entities
      set admin = false
      where did = $1::text;
    `,
      [did]
    )
  }

  public static async addEntity(did: string) {
    return pool.query(
      `
      insert into entities
      (did) values ($1::text)
      on conflict(did) do nothing;
    `,
      [did]
    )
  }

  public static async isAdmin(did: string, client?: PoolClient): Promise<boolean> {
    const result = await this.query(
      async c =>
        c.query(
          `
        select 1 from entities
        where did = $1::text and admin = true;
      `,
          [did]
        ),
      client
    )
    return result.rows.length === 1
  }
}
