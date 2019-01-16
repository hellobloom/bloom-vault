const config = {
  "username": "postgres",
  "user": "postgres",
  "password": process.env.POSTGRES_PASSWORD,
  "database": "postgres",
  "host": "db",
  "dialect": "postgres"
}
module.exports = {
  "development": config,
  "production": config,
  "default": config
}