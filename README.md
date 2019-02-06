## Running debug mode
no need to change any config

```
npm install
npm run docker-debug
```

use the VSCode debug profiles to attach the debugger to the server or the tests or both

## Tests
first start up in debug mode using the commands above then

`npm run test`

## Hot reloading
using the VSCode debug profile "Attach to Docker" will enable hot reloading. Or you can run `npm run watch` in a separate terminal

## Running production mode

first set the required environment variables like so

```
cp .env.sample .env
nano .env #edit your file
chmod 600 .env
```

then

```
docker-compose up --build -d && docker-compose logs -f
```
it will keep running after you're finished looking at the logs

## Reseting (will delete ALL data)

`docker-compose -f debug-compose.yml down --volumes`

## Gotchas
- the POSTGRES_PASSWORD will be set in the volume the first time running and will not reset between rebuilding the images. If you want to change the password you have to either remove the volume using the command above or connect using a pg client and change it