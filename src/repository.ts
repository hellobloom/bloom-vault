import * as config from '../database'
import {persistError} from './logger'
import {Pool, PoolClient, ClientBase} from 'pg'
import {env} from './environment'
import {udefCoalesce} from './utils'

const pool = new Pool(
  env.nodeEnv() === 'production' ? config.production : config.development
)

pool.on('error', (err, client) => {
  persistError(err.message, err.stack!)
})

export interface IEntity {
  fingerprint: Buffer
  key: Buffer
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

  public static async getDeletions(
    fingerprint: Buffer,
    start: number,
    end?: number
  ) {
    const result = await pool.query(
      `
        select data_id, signature
        from deletions
        where 1=1
          and id >= $2 and ($3::integer is null or id <= $3::integer)
          and fingerprint = $1::pgp_fingerprint
        order by id;
      `,
      [fingerprint, start, udefCoalesce(end, null)]
    )
    return result.rows as Array<{
      data_id: number
      signature: Buffer | null
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

  public static async deleteData(
    fingerprint: Buffer,
    ids: number[],
    signatures: Buffer[] | Uint8Array[]
  ) {
    return this.transaction(async client => {
      const newCount = await client.query(
        `
          update entities set deleted_count = deleted_count + $2
          where fingerprint = $1::pgp_fingerprint
          returning deleted_count, data_count;`,
        [fingerprint, ids.length]
      )

      const query = `
        insert into deletions
        (fingerprint,           id,        data_id,   signature) values ${this.values(
          ['pgp_fingerprint', 'integer', 'integer', 'bytea'],
          ids.length
        )};
      `
      const values = ids
        .map((id, i) => [
          fingerprint,
          newCount.rows[0].deleted_count - (ids.length - i),
          id,
          udefCoalesce(signatures[i], null),
        ])
        .reduce((v1, v2) => v1.concat(v2), [])

      await client.query(query, values)

      await client.query(
        `update data set cyphertext = null where fingerprint = $1::pgp_fingerprint and id in ${this.in(
          ids.length,
          2
        )};`,
        [fingerprint, ...ids]
      )

      return {
        deletedCount: newCount.rows[0].deleted_count as number,
        dataCount: newCount.rows[0].data_count as number,
      }
    })
  }

  public static async insertData(
    fingerprint: Buffer,
    cyphertext: Buffer | Uint8Array,
    id?: number
  ) {
    return this.transaction(async client => {
      const result = await client.query(
        `
          update entities set data_count = data_count + 1
          where fingerprint = $1::pgp_fingerprint and ($2::integer is null or data_count = $2::integer)
          returning data_count - 1 as id;
        `,
        [fingerprint, udefCoalesce(id, null)]
      )
      if (result.rowCount === 0) {
        return null
      }

      const newId = result.rows[0].id as number

      await client.query(
        `
          insert into data
          (fingerprint  ,id  ,cyphertext) values
          ($1           ,$2  ,$3);
        `,
        [fingerprint, newId, cyphertext]
      )
      return newId
    })
  }

  public static async getData(fingerprint: Buffer, start: number, end?: number) {
    const result = await pool.query(
      `
        select id, cyphertext
        from data
        where 1=1
          and id >= $2 and id <= coalesce($3::integer, $2)
          and fingerprint = $1::pgp_fingerprint
        order by id;
      `,
      [fingerprint, start, udefCoalesce(end, null)]
    )
    return result.rows as Array<{
      id: number
      cyphertext: Buffer | null
    }>
  }

  public static async getMe(fingerprint: Buffer) {
    const result = await pool.query(
      `select key, data_count, deleted_count from entities where fingerprint = $1::pgp_fingerprint;`,
      [fingerprint]
    )
    if (result.rowCount === 0) {
      throw new Error('could not find entity')
    }
    return result.rows[0] as {data_count: number; key: Buffer; deleted_count: number}
  }

  public static async getEntity(
    token: string
  ): Promise<{key: Buffer; fingerprint: Buffer; blacklisted: boolean} | null> {
    const result = await pool.query(
      `
      select key, e.fingerprint, e.blacklisted
      from entities e
      join access_token a on e.fingerprint = a.fingerprint
      where a.uuid = $1;
    `,
      [token]
    )

    if (result.rowCount === 0) {
      return null
    }
    return result.rows[0]
  }

  public static async createAccessToken(
    fingerprint: Buffer,
    initialize: boolean = false
  ) {
    return this.transaction(async client => {
      if (initialize === true) {
        await client.query(
          `
          insert into entities
          (fingerprint, admin) select $1::pgp_fingerprint, true
          where (select count(*) from entities) = 0
        `,
          [fingerprint]
        )
      }

      const created = await client.query(
        `
        insert into entities
        (fingerprint) values ($1::pgp_fingerprint)
        on conflict(fingerprint) do nothing
        returning gen_random_uuid() as uuid;
      `,
        [fingerprint]
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
        insert into access_token (fingerprint) values ($1) returning uuid;
      `,
        [fingerprint]
      )

      return token.rows[0].uuid as string
    })
  }

  public static async validateAccessToken(token: string, key?: Buffer | Uint8Array) {
    return this.transaction(async client => {
      const result = await client.query(
        `
        update access_token set validated_at = now()
        where 1=1
          and uuid = $1
          and validated_at is null
        returning fingerprint, date_part('epoch',now() + ($2 || ' seconds')::interval)::int as expires_at;
        `,
        [token, env.tokenExpirationSeconds()]
      )

      const row = result.rows[0] as {expires_at: number; fingerprint: Buffer}
      if (!row) {
        return null
      }

      if (key) {
        const update = await client.query(
          `update entities set key = $1 where fingerprint::pgp_fingerprint = $2 and key is null`,
          [key, row.fingerprint]
        )
        if (update.rowCount !== 1) {
          return null
        }
      }

      return row.expires_at
    })
  }

  public static async checkAccessToken(token: string) {
    const result = await pool.query(
      `
      select e.fingerprint, e.key
      from access_token at
      join entities e on e.fingerprint = at.fingerprint
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

  public static async addBlacklist(fingerprint: Buffer) {
    return pool.query(
      `
      insert into entities
      (fingerprint, blacklisted) values ($1::pgp_fingerprint, true)
      on conflict(fingerprint) do update set blacklisted = true;
    `,
      [fingerprint]
    )
  }

  public static async removeBlacklist(fingerprint: Buffer) {
    return pool.query(
      `
      update entities
      set blacklisted = false
      where fingerprint = $1::pgp_fingerprint;
    `,
      [fingerprint]
    )
  }

  public static async addAdmin(fingerprint: Buffer) {
    return pool.query(
      `
      insert into entities
      (fingerprint, admin) values ($1::pgp_fingerprint, true)
      on conflict(fingerprint) do update set admin = true;
    `,
      [fingerprint]
    )
  }

  public static async removeAdmin(fingerprint: Buffer) {
    return pool.query(
      `
      update entities
      set admin = false
      where fingerprint = $1::pgp_fingerprint;
    `,
      [fingerprint]
    )
  }

  public static async addEntity(fingerprint: Buffer) {
    return pool.query(
      `
      insert into entities
      (fingerprint) values ($1::pgp_fingerprint)
      on conflict(fingerprint) do nothing;
    `,
      [fingerprint]
    )
  }

  public static async isAdmin(
    fingerprint: Buffer,
    client?: PoolClient
  ): Promise<boolean> {
    const result = await this.query(
      async c =>
        c.query(
          `
        select 1 from entities
        where fingerprint = $1::pgp_fingerprint and admin = true;
      `,
          [fingerprint]
        ),
      client
    )
    return result.rows.length === 1
  }
}
