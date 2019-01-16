## Running
export POSTGRES_PASSWORD=DONTUSETHISPASSWORD

docker-compose up

## Running debug
export POSTGRES_PASSWORD=DONTUSETHISPASSWORD

docker-compose -f docker-compose.yml -f debug-compose.yml up --build

## Reseting (will delete data)
docker-compose down --volumes