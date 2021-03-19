import {udefCoalesce} from './src/utils'
import * as fs from 'fs'

const ca = '/var/run/secrets/pg_ca'
const shouldCheckServerIdentity =
  udefCoalesce(process.env.POSTGRES_CHECKSI, 'false')
    .trim()
    .toLowerCase() === 'true'
export const production = {
  user: udefCoalesce(process.env.POSTGRES_USER, 'postgres'),
  password: process.env.POSTGRES_PASSWORD,
  host: udefCoalesce(process.env.POSTGRES_HOST, 'productiondb'),
  port: parseInt(udefCoalesce(process.env.POSTGRES_PORT, '5432'), 10),
  database: udefCoalesce(process.env.POSTGRES_DATABASE, 'postgres'),
  ssl: fs.existsSync(ca)
    ? {
        ca: fs.readFileSync(ca),
        checkServerIdentity: shouldCheckServerIdentity ? undefined : () => undefined,
      }
    : undefined,
}
export const mocha = {
  user: udefCoalesce(process.env.POSTGRES_USER, 'postgres'),
  password: process.env.POSTGRES_PASSWORD,
  host: 'localhost',
  port: parseInt(udefCoalesce(process.env.POSTGRES_PORT, '5434'), 10),
  database: udefCoalesce(process.env.POSTGRES_DATABASE, 'debug'),
}
export const development = {
  user: udefCoalesce(process.env.POSTGRES_USER, 'postgres'),
  password: process.env.POSTGRES_PASSWORD,
  host: udefCoalesce(process.env.POSTGRES_HOST, 'debugdb'),
  database: udefCoalesce(process.env.POSTGRES_DATABASE, 'debug'),
}
