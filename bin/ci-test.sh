#!/bin/bash

echo "Installing dependencies"
npm ci

echo "Building"
npm run build

echo "Sourcing .env.test"
bin_dir=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )
echo "bin_dir = $bin_dir"
. $bin_dir/../.env.test

echo "pg db: $POSTGRES_DATABASE"
echo "pg user: $POSTGRES_USER"
echo "pg pwd: $POSTGRES_PASSWORD"
echo "node env: $NODE_ENV"

echo "Postgres permissions config begin"
su - postgres -c "createuser -s -i -d -r -l -w root"
su - postgres -c "psql -c \"ALTER ROLE root WITH PASSWORD 'DONTUSETHISPASSWORD';\""
PGPASSWORD=$POSTGRES_PASSWORD dropdb --if-exists -h localhost -p 5432 -U root -w $POSTGRES_DATABASE
PGPASSWORD=$POSTGRES_PASSWORD createdb -h localhost -p 5432 -U root $POSTGRES_DATABASE

echo "'cat'ing the contents from .env.test into .env for migrate, start, and test"
cat $bin_dir/../.env.test > $bin_dir/../.env

echo "Starting server for tests"
npm run start & test_server_pid=$!
echo "Started server with pid $test_server_pid"
sleep 15

echo "Running tests"
npm run test || exit 1

echo "Killing $test_server_pid"
kill -9 $test_server_pid