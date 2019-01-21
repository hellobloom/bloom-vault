import * as http from 'http'
import * as express from 'express'
import * as bodyParser from 'body-parser'

import {env} from './src/environment'

import { persistError } from './src/logger'

import {meRouter} from './src/routes/me'
import { tokenRouter as authRouter } from './src/routes/auth'
import { ClientFacingError } from './src/requestUtils'

const app = express()
const server = http.createServer(app)
const port = 3001
server.listen(port)
app.use(bodyParser.json({limit: '10mb'}))

// coors
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  return next()
})

authRouter(app)
meRouter(app)

app.get('*', (req, res, next) => res.status(404).end())
app.post('*', (req, res, next) => res.status(404).end())

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const message = err instanceof ClientFacingError ? err.message : 'Something went wrong'
  const status = err instanceof ClientFacingError ? err.status : 500
  res.status(status).json({error: message})
  persistError(err.message, err.stack!)
})

console.log(`Starting server in ${env.pipelineStage} mode`)
console.log(`Local:  http://localhost:${port}/`)

process.on('unhandledRejection', error => {
  if (error) {
    console.log(error)
    persistError(error.message, error.stack)
  }
})