import * as express from 'express-serve-static-core'
import {apiOnly, adminOnly} from '../requestUtils'
import { env } from '../environment'

export const debugRouter = (app: express.Application) => {
  app.post(
    '/debug/set-env/:key/:value',
    apiOnly,
    adminOnly,
    (req, res) => {
      process.env[req.params.key] = req.params.value
      return res.status(200).end()
    }
  )
}
