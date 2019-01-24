## Running production mode
`POSTGRES_PASSWORD=DONTUSETHISPASSWORD PIPELINE_STAGE=production docker-compose up`

## Running debug mode
```npm install```
```npm run docker-debug```

use the VSCode debug profiles to attach the debugger to the server or the tests or both

## tests
`npm run test`

## Reseting (will delete ALL data)
`docker-compose -f debug-compose.yml down --volumes`