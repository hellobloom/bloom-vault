import * as express from 'express-serve-static-core'
import {apiOnly, asyncHandler, ipRateLimited, noValidator} from '../requestUtils'

export const misc = (app: express.Application) => {
  app.get(
    '/api/v1/health',
    ipRateLimited(60, 'me'),
    apiOnly,
    asyncHandler(noValidator, async () => {
      return {
        status: 200,
        body: {
          success: true,
        },
      }
    })
  )
}
