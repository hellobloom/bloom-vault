import * as config from '../database'
import { persistError } from './logger'
import { Pool, PoolClient } from 'pg'
import { env } from './environment';

const pool = new Pool(env.nodeEnv === 'production' ? config.production : config.development)

pool.on('error', (err, client) => {
  persistError(err.message, err.stack!)
})

export default class Repo {
  
  static tokenExpiration = '1 day'
  
  static async transaction<T>(callback: (client: PoolClient) => Promise<T>) {
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

  static async getEntity(token: string): Promise<{key: Buffer, fingerprint: Buffer} | null> {
    const result = await pool.query(`
      select key, e.fingerprint
      from entities e
      join access_token a on e.fingerprint = a.fingerprint
      where a.uuid = $1;
    `, [token])

    if(result.rowCount === 0) return null
    return result.rows[0]
  }

  static async createAccessToken(fingerprint: Buffer): Promise<string> {
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

  static async validateAccessToken(token: string, key?: Buffer) {
    return this.transaction(async client => {
      const result = await client.query(`
        update access_token set validated_at = now()
        where 1=1
          and uuid = $1
          and validated_at is null
        returning fingerprint, date_part('epoch',now() + interval '${this.tokenExpiration}')::int as expires_at;
        `, [token]
      )

      const row = result.rows[0] as {expires_at: number, fingerprint: Buffer}
      if(!row) return null

      if(key) {
        const update = await client.query(
          `update entities set key = $1 where fingerprint::pgp_fingerprint = $2 and key is null`,
          [key, row.fingerprint]
        )
        if(update.rowCount !== 1) return null
      }

      return row.expires_at
    })
  }

  static async checkAccessToken(token: string): Promise<void> {
    const result = await pool.query(`
      select fingerprint from access_token where uuid = $1 and validated_at between now() - interval '${this.tokenExpiration}' and now();
    `, [token])

    if(result.rowCount !== 1) throw new Error('invalid token')
  }

}

