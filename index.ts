import * as http from 'http'
import * as express from 'express'
import * as bodyParser from 'body-parser'
import * as morgan from 'morgan'

import {env, PipelineStages} from './src/environment'

import {persistError} from './src/logger'

import {dataRouter} from './src/routes/data'
import {tokenRouter as authRouter} from './src/routes/auth'
import {misc} from './src/routes/misc'
import {ClientFacingError} from './src/utils'
import {adminOnlyHandler} from './src/requestUtils'

const helmet = require('helmet')

const app = express()

app.use(helmet())
app.use(morgan('tiny'))

const server = http.createServer(app)
const port = 3001
server.listen(port)
app.use(bodyParser.json({limit: '10mb'}))

if (env.trustProxy() === true) {
  app.enable('trust proxy')
}

// CORS: https://enable-cors.org/
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  return next()
})

authRouter(app)
dataRouter(app)
misc(app)

if (env.pipelineStage() === PipelineStages.development) {
  app.post(
    '/debug/set-env/:key/:value',
    adminOnlyHandler(
      async (req, res) => {
        return {
          key: req.params.key as string,
          value: req.params.value as string,
        }
      },
      async ({key, value}) => {
        process.env[key] = value
        return {
          status: 200,
          body: {},
        }
      }
    )
  )
}

app.get('*', (req, res, next) => res.status(404).end())
app.post('*', (req, res, next) => res.status(404).end())

app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const message =
      err instanceof ClientFacingError ? err.message : 'Something went wrong'
    const status = err instanceof ClientFacingError ? err.status : 500
    res.status(status).json({error: message})
    persistError(err.message, err.stack!)
  }
)

console.log(`Starting server in ${env.pipelineStage()} mode`)
console.log(`Local:  http://localhost:${port}/`)

process.on('unhandledRejection', error => {
  if (error) {
    persistError(error.message, error.stack)
  }
})
