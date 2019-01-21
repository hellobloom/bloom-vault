import * as express from 'express-serve-static-core'
import {apiOnly, asyncHandler, authorized} from '../requestUtils'

export const meRouter = (app: express.Application) => {
  
  app.get('/me', apiOnly, authorized, asyncHandler(
    async (req, res, next) => {},
    async () => {
      return {
        status: 200,
        body: {}
      }
    }
  ))
}
