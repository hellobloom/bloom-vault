const config = {
  user: "postgres",
  password: process.env.POSTGRES_PASSWORD,
  database: "postgres",
  host: "db"
}
module.exports = {
  production: config,
  mocha: {...config, host: 'localhost', port: 5433, database: 'test'},
  development: {...config, database: 'test'},
}