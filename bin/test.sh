#!/bin/bash
echo "Running bin/test.sh"
npm ci
npm run build
docker-compose -f docker-debug.yml up --build -d
# sleep 30 give the docker-compose up plenty of time to run the web server for npm run test
sleep 30
npm run test || exit 1
docker-compose -f docker-debug.yml down
