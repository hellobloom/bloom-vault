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
        key bytea unique,
        data_count integer not null default 0,
        deleted_count integer not null default 0
      );

      create table data (
        id integer not null,
        fingerprint pgp_fingerprint references entities not null,
        cyphertext bytea null,
        primary key (id, fingerprint)
      );

      create table deletions (
        id integer not null,
        data_id integer not null,
        fingerprint pgp_fingerprint references entities not null,
        signature bytea null,
        primary key (id, fingerprint),
        foreign key (data_id, fingerprint) references data
      );

      create table access_token (
        uuid         uuid default uuid_generate_v4() primary key,
        fingerprint    pgp_fingerprint not null references entities,
        validated_at timestamp with time zone
      );
      create table ip_call_count
      (
        ip varchar(39) not null,
        created_at timestamp default now() not null,
        updated_at timestamp default now() not null,
        endpoint varchar(50) not null,
        minute smallint default date_part('minute'::text, CURRENT_TIMESTAMP) not null,
        count integer default 1 not null,
        constraint ip_call_count_pkey primary key (ip, endpoint)
      );
      `,
    down: `
      drop table ip_call_count;
      drop table access_token;
      drop table deletions;
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
