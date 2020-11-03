#!/bin/bash
echo "Running bin/test.sh"
npm run build
docker-compose -f docker-test.yml up --build -d
# sleep 60 give the docker-compose up plenty of time to run the web server for npm run test
sleep 60
bin_dir=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )
. $bin_dir/../.env.debug
PGPASSWORD=$POSTGRES_PASSWORD dropdb --if-exists -h localhost -p 5434 -U jenkins -w $POSTGRES_DATABASE
PGPASSWORD=$POSTGRES_PASSWORD createdb -h localhost -p 5434 -U jenkins $POSTGRES_DATABASE
POSTGRES_USER=jenkins npm run test || exit 1
docker-compose -f docker-test.yml down
