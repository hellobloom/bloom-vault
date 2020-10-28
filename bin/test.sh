#!/bin/bash
echo "Running bin/test.sh"
npm run build
echo "npm run build succeeded"
docker-compose -f docker-test.yml up --build -d
echo "docker-compose up succeeded"
# sleep 60 give the docker-compose up plenty of time to run the web server for npm run test
sleep 60
echo "slept 60"
bin_dir=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )
echo "bin_dir = $bin_dir"
. $bin_dir/../.env.debug
echo "sourcing .env.debug succeeded"

echo "postgres permissions config begin"
su - postgres -c "createuser -s -i -d -r -l -w root"
su - postgres -c "psql -c \"ALTER ROLE root WITH PASSWORD 'root';\""
su - postgres -c "createuser -s -i -d -r -l -w jenkins"
su - postgres -c "psql -c \"ALTER ROLE jenkins WITH PASSWORD '$POSTGRES_PASSWORD';\""

echo "before"
# docker ps
docker-compose -f docker-test.yml ps
echo "after"

echo "pg pwd = $POSTGRES_PASSWORD, pg db = $POSTGRES_DATABASE"
PGPASSWORD=$POSTGRES_PASSWORD dropdb --if-exists -h localhost -p 5434 -U jenkins -w $POSTGRES_DATABASE
PGPASSWORD=$POSTGRES_PASSWORD createdb -h localhost -p 5434 -U jenkins $POSTGRES_DATABASE
POSTGRES_USER=jenkins npm run test || exit 1
echo "npm run test success"

docker-compose -f docker-test.yml down --volumes
echo "docker-compose down"
