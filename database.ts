import {udefCoalesce} from './src/utils'

export const production = {
  user: udefCoalesce(process.env.POSTGRES_USER, 'postgres'),
  password: process.env.POSTGRES_PASSWORD,
  host: udefCoalesce(process.env.POSTGRES_HOST, 'productiondb'),
  port: udefCoalesce(process.env.POSTGRES_PORT, 5432),
  database: udefCoalesce(process.env.POSTGRES_DATABASE, 'postgres'),
  ssl: process.env.POSTGRES_REQUIRE_SSL ? {rejectUnauthorized: true} : undefined,
}
export const mocha = {
  user: 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  host: 'localhost',
  port: 5433,
  database: 'debug',
}
export const development = {
  user: 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  host: 'debugdb',
  database: 'debug',
}
