import * as express from 'express-serve-static-core'
import {apiOnly} from '../requestHandlers'

export const tokenRouter = (app: express.Application) => {
  app.post('/auth/request-token',apiOnly, async (req, res, next) => {
    try {
      const test = 'asdff'
      return res.status(200).json({token: test})
    } catch (err) {
      return next(err)
    }
  })
}
