#!/bin/bash
echo "Running bin/test.sh"
npm run build
docker-compose -f docker-test.yml up --build -d
# sleep 30 give the docker-compose up plenty of time to run the web server for npm run test
sleep 30
POSTGRES_USER=jenkins npm run test || exit 1
docker-compose -f docker-test.yml down
