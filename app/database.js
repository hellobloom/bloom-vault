const config = {
  "username": "postgres",
  "password": process.env.POSTGRES_PASSWORD,
  "database": "postgres",
  "host": "db",
  "dialect": "postgres"
}
module.exports = {
  "development": config,
  "production": config
}