'use strict'

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
    BEGIN;

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
    
    COMMIT;
    `)
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
    BEGIN TRANSACTION;
    drop table access_token;
    drop table data;
    drop table entities;
    drop domain pgp_fingerprint;
    COMMIT;
    `)
  },
}
