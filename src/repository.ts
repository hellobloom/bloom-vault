import * as config from '../database'
import { persistError } from './logger'
import { Pool, PoolClient } from 'pg'
import { env } from './environment'

const pool = new Pool(env.nodeEnv === 'production' ? config.production : config.development)

pool.on('error', (err, client) => {
  persistError(err.message, err.stack!)
})

export interface IEntity {
  fingerprint: Buffer
  key: Buffer
}

export default class Repo {

  public static tokenExpiration = '1 day'

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

  public static async getDeletions(fingerprint: Buffer, start: number, end?: number) {
    const result = await pool.query(
      `
        select data_id, signature
        from deletions
        where 1=1
          and id >= $2 and ($3 is null or id <= $3)
          and fingerprint = $1::pgp_fingerprint
        order by id;
      `,
      [fingerprint, start, end || null],
    )
    return result.rows as Array<{
      data_id: number,
      signature: Buffer | null,
    }>
  }

  public static async deleteData(fingerprint: Buffer, ids: number[], signatures: Buffer[]) {
    return this.transaction(async (client) => {
      const newCount = await client.query(
        `
          update entities set deleted_count = deleted_count + $2
          where fingerprint = $1::pgp_fingerprint
          returning deleted_count, data_count;`,
        [fingerprint, ids.length],
      )

      const values = ids.map((id, i) => ([
        fingerprint,
        newCount.rows[0].deleted_count - (ids.length - i),
        id,
        signatures[i] || null,
      ])).reduce((v1, v2) => v1.concat(v2), [])

      await client.query((`
        insert into deletions
        (fingerprint           ,id ,data_id ,signature) values` + ids.map(i => (`
        ($::pgp_fingerprint    ,$  ,$       ,$),`))).slice(0, -1)
        ,
        values,
      )

      await client.query(`update data set cyphertext = null where fingerprint = $1::pgp_fingerprint and id in ($2);`, [fingerprint, ids])

      return {
        deletedCount: newCount.rows[0].deleted_count as number,
        dataCount: newCount.rows[0].data_count as number,
      }
    })
  }

  public static async insertData(fingerprint: Buffer, cyphertext: Buffer | Uint8Array, id?: number) {
    return this.transaction(async (client) => {
      const result = await client.query(
        `
          update entities set data_count = data_count + 1
          where fingerprint = $1::pgp_fingerprint and ($2::integer is null or data_count = $2::integer)
          returning data_count - 1 as id;
        `,
        [fingerprint, id || null],
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
        [fingerprint, newId, cyphertext],
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
          and id >= $2 and ($3::integer is null or id <= $3::integer)
          and fingerprint = $1::pgp_fingerprint
        order by id;
      `,
      [fingerprint, start, end || null],
    )
    return result.rows as Array<{
      id: number,
      cyphertext: Buffer | null,
    }>
  }

  public static async getMe(fingerprint: Buffer) {
    const result = await pool.query(`select key, data_count, deleted_count from entities where fingerprint = $1::pgp_fingerprint;`, [fingerprint])
    if (result.rowCount === 0) { throw new Error('could not find entity') }
    return result.rows[0] as {data_count: number, key: Buffer, deleted_count: number}
  }

  public static async getEntity(token: string): Promise<{key: Buffer, fingerprint: Buffer} | null> {
    const result = await pool.query(`
      select key, e.fingerprint
      from entities e
      join access_token a on e.fingerprint = a.fingerprint
      where a.uuid = $1;
    `, [token])

    if (result.rowCount === 0) { return null }
    return result.rows[0]
  }

  public static async createAccessToken(fingerprint: Buffer): Promise<string> {
    await pool.query(`
      insert into entities
      (fingerprint) select ($1::pgp_fingerprint)
      where not exists (select 1 from entities where fingerprint = $1::pgp_fingerprint);
    `, [fingerprint])

    const token = await pool.query(`
      insert into access_token (fingerprint) values ($1) returning uuid;
    `, [fingerprint])

    return token.rows[0].uuid
  }

  public static async validateAccessToken(token: string, key?: Buffer | Uint8Array) {
    return this.transaction(async client => {
      const result = await client.query(`
        update access_token set validated_at = now()
        where 1=1
          and uuid = $1
          and validated_at is null
        returning fingerprint, date_part('epoch',now() + interval '${this.tokenExpiration}')::int as expires_at;
        `, [token],
      )

      const row = result.rows[0] as {expires_at: number, fingerprint: Buffer}
      if (!row) { return null }

      if (key) {
        const update = await client.query(
          `update entities set key = $1 where fingerprint::pgp_fingerprint = $2 and key is null`,
          [key, row.fingerprint],
        )
        if (update.rowCount !== 1) { return null }
      }

      return row.expires_at
    })
  }

  public static async checkAccessToken(token: string) {
    const result = await pool.query(`
      select e.fingerprint, e.key
      from access_token at
      join entities e on e.fingerprint = at.fingerprint
      where uuid = $1 and validated_at between now() - interval '${this.tokenExpiration}' and now();
    `, [token])

    if (result.rowCount !== 1) { return null }
    return result.rows[0] as IEntity
  }

}
