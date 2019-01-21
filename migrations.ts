'use strict'
import * as config from './database'
import { Client } from 'pg'

interface IMigration {
  name: string,
  up: string,
  down: string
}

const migrations: IMigration[] = [
  {
    name: 'initial',
    up: `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      create domain pgp_fingerprint as bytea constraint fingerprint_length check (octet_length(VALUE) = 20);

      create table entities (
        fingerprint pgp_fingerprint primary key,
        key bytea unique
      );

      create table data (
        index integer not null,
        fingerprint pgp_fingerprint references entities not null,
        cyphertext bytea not null,
        primary key (index, fingerprint)
      );

      create table access_token (
        uuid         uuid default uuid_generate_v4() primary key,
        fingerprint    pgp_fingerprint not null references entities,
        validated_at timestamp with time zone
      );
      `,
    down: `
      drop table access_token;
      drop table data;
      drop table entities;
      drop domain pgp_fingerprint;
    `,
  },
]

export async function up(conf: any, logs: boolean = true) {
  const client = new Client(conf)
  await client.connect()
  logs && console.log('running migrations')

  await client.query(`create table if not exists migrations (name text primary key);`)

  for (const migration of migrations) {
    const result = await client.query(`select name from migrations where name = $1`, [migration.name])

    if (result.rowCount !== 0) { continue }
    logs && console.log('running ' + migration.name)
    try {
      await client.query('BEGIN')
      await client.query(`insert into migrations values ($1);`, [migration.name])
      await client.query(migration.up)
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    }
  }
  await client.end()
}

export async function down(conf: any, logs: boolean = true) {
  const client = new Client(conf)
  await client.connect()
  logs && console.log('reverting migrations')

  await client.query(`create table if not exists migrations (name text primary key);`)

  for (const migration of migrations.reverse()) {
    const result = await client.query(`select name from migrations where name = $1`, [migration.name])

    if (result.rowCount === 0) { continue }
    logs && console.log('reverting ' + migration.name)
    try {
      await client.query('BEGIN')
      await client.query(`delete from migrations where name = $1;`, [migration.name])
      await client.query(migration.down)
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    }
  }
  await client.end()
}

process.on('unhandledRejection', (reason) => {
  throw reason
})

if (!module.parent) {
  up(config[process.env.NODE_ENV!])
  .catch(e => {throw e})
}
