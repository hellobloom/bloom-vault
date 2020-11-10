#!/bin/bash

echo "Installing dependencies"
npm ci

echo "Building"
npm run build

echo "Adding .env.test to environment"
export $(cat .env.test | xargs)

echo "Postgres config for root"
su - postgres -c "createuser -s -i -d -r -l -w root"
su - postgres -c "psql -c \"ALTER ROLE root WITH PASSWORD '$POSTGRES_PASSWORD';\""
PGPASSWORD=$POSTGRES_PASSWORD dropdb --if-exists -h localhost -p 5432 -U root -w $POSTGRES_DATABASE
PGPASSWORD=$POSTGRES_PASSWORD createdb -h localhost -p 5432 -U root $POSTGRES_DATABASE

echo "Starting server for tests with .env.test environment vars"
npm run start & test_server_pid=$!
echo "Started server with pid '$test_server_pid'"

echo "Sleeping for 15 seconds to give the server a chance to boot prior to tests"
sleep 15

echo "Running tests"
npm run test || exit 1

echo "Killing server with pid '$test_server_pid'"
kill -9 $test_server_pid