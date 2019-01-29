## Running debug mode
```
npm install
npm run docker-debug
```

use the VSCode debug profiles to attach the debugger to the server or the tests or both

## tests
`npm run test`

## Running production mode
first set the required environment variables
```
cp .env.sample .env
nano .env
chmod 600 .env
```
then
```
docker-compose up
```

## Reseting (will delete ALL data)
`docker-compose -f debug-compose.yml down --volumes`
