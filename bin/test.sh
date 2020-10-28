#!/bin/bash
echo "Running bin/test.sh"
npm run build
echo "npm run build succeeded"
docker-compose -f docker-test.yml up --build -d
# docker-compose --verbose -f docker-test.yml up --build
echo "docker-compose up succeeded"
# sleep 90 give the docker-compose up plenty of time to run the web server for npm run test
sleep 90
echo "slept 90"
bin_dir=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )
echo "bin_dir = $bin_dir"
. $bin_dir/../.env.debug
echo "sourcing .env.debug succeeded"

echo "postgres permissions config begin"
su - postgres -c "createuser -s -i -d -r -l -w root"
su - postgres -c "psql -c \"ALTER ROLE root WITH PASSWORD 'root';\""

echo "before"
docker ps
docker-compose -f docker-test.yml ps
echo "after"

echo "pg pwd = $POSTGRES_PASSWORD, pg db = $POSTGRES_DATABASE"
PGPASSWORD=$POSTGRES_PASSWORD dropdb --if-exists -h 0.0.0.0 -p 5434 -U jenkins -w $POSTGRES_DATABASE
PGPASSWORD=$POSTGRES_PASSWORD createdb -h 0.0.0.0 -p 5434 -U jenkins $POSTGRES_DATABASE
POSTGRES_USER=jenkins npm run test || exit 1
echo "npm run test success"

docker-compose -f docker-test.yml down --volumes
echo "docker-compose down"
