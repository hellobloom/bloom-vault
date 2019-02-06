const config = {
  user: 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  database: 'postgres',
  host: 'productiondb',
}
module.exports = {
  production: config,
  mocha: {...config, host: 'localhost', port: 5433, database: 'debug'},
  development: {...config, host: 'debugdb', database: 'debug'},
}
