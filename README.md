## Dependencies

- [docker](https://docs.docker.com/install/)
- [docker-compose](https://docs.docker.com/compose/install/)

## Running debug mode

install node if you havent already ([version 10 recommended](https://nodejs.org/dist/v10.15.1/)) \*if you have nvm run `nvm use`

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

### if you are using the included postgres image

```
docker-compose -f docker-compose.yml -f db-compose.yml up --build -d
```

### else if you are using an external database

make sure you set the following values in your .env file (see above)

```
POSTGRES_USER
POSTGRES_HOST
POSTGRES_PORT
POSTGRES_DATABASE
POSTGRES_REQUIRE_SSL
```

then start up the container

```
docker-compose up --build -d
```

## Reseting (will delete ALL data)

`docker-compose -f debug-compose.yml down --volumes`

## Error Logging

if you want errors to be posted as json to an external logging service set the following environement variables

```
LOG_URL
LOG_USER
LOG_PASSWORD
```

the logger will use basic http authentication with the username and password

## Database Backups

if you use the included postgres image and want to periodically back up the volume, set the `BACKUP_LOCATION` environment variable to a location on the host machine

## Gotchas

- the POSTGRES_PASSWORD will be set in the volume the first time running and will not reset between rebuilding the images. If you want to change the password you have to either remove the volume using the command above or connect using a pg client and change it
