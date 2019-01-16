import * as config from '../database'
import { persistError } from './logger'
import { Pool, PoolClient } from 'pg'

const pool = new Pool(config.default)

// the pool with emit an error on behalf of any idle clients
// it contains if a backend error or network partition happens
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

  static async createAccessToken(fingerprint: Buffer): Promise<string> {
    await pool.query(`
      insert into entities 
      (fingerprint) select ($1) 
      where not exists (select 1 from entities where fingerprint = $1);
    `, [fingerprint])
    
    const token = await pool.query(`
      insert into access_token (fingerprint) values ($1) returning uuid;
    `, [fingerprint])

    return token.rows[0].uuid
  }

  static async authorizeAccessToken(fingerprint: Buffer, token: string): Promise<void> {
    const result = await pool.query(`
      update access_token set validated_at = now()
      where 1=1
        and fingerprint = $1
        and uuid = $2
        and validated_at is null
      returning date_part('epoch',now() + interval '${this.tokenExpiration}')::int;
    `, [fingerprint, token])

    if(result.rowCount !== 1) throw new Error('invalid token/fingerprint')
  }

  static async checkAccessToken(token: string): Promise<void> {
    const result = await pool.query(`
      select fingerprint from access_token where uuid = $1 and validated_at between now() - interval '${this.tokenExpiration}' and now();
    `, [token])

    if(result.rowCount !== 1) throw new Error('invalid token')
  }

}

