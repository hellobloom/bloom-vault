## Running debug mode
`docker-compose -f debug-compose.yml up --build`

## Running production mode
`POSTGRES_PASSWORD=DONTUSETHISPASSWORD PIPELINE_STAGE=production docker-compose up`

## Reseting (will delete ALL data)
`docker-compose -f debug-compose.yml down --volumes`