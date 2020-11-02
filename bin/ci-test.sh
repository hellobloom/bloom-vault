#!/bin/bash

echo "Installing dependencies"
npm ci

echo "Building"
npm run build

echo "Sourcing .env.debug"
bin_dir=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )
echo "bin_dir = $bin_dir"
. $bin_dir/../.env.debug

echo "Postgres permissions config begin"
su - postgres -c "createuser -s -i -d -r -l -w root"
su - postgres -c "psql -c \"ALTER ROLE root WITH PASSWORD 'root';\""
PGPASSWORD=$POSTGRES_PASSWORD dropdb --if-exists -h localhost -p 5432 -U root -w $POSTGRES_DATABASE
PGPASSWORD=$POSTGRES_PASSWORD createdb -h localhost -p 5434 -U root $POSTGRES_DATABASE

echo "Migrate database"
npm run migrate

echo "Starting server for tests"
npm run start & test_server_pid=$!
echo "Started server with pid $test_server_pid"
lsof -i tcp:3000
sleep 15

echo "Running tests"
npm run test || exit 1

echo "Killing $test_server_pid"
kill -9 $test_server_pid