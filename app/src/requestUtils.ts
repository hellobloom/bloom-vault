import {RequestHandler, NextFunction, Request, Response} from 'express-serve-static-core'

export class ClientFacingError extends Error {}

export function asyncHandler(
  handler:(req: Request, res: Response , next: NextFunction
) => Promise<void>) {
  return async(req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, next)
    } catch (err) {
      return next(err)
    }
  }
}

export const apiOnly: RequestHandler = (req, res, next) => {
  if (req.header('Content-Type') === 'application/json') {
    next()
  } else {
    // 415 = Unsupported media type
    res.status(415).end()
  }
}

export const basicAuth = function(
  userName: string,
  password: string
): RequestHandler {
  return async (req, res, next) => {
    try {
      const basicAuthRegex = /(?:Basic|BASIC|basic) (\w+)/
      const auth = req.header('Authorization')

      if (!auth) return res.status(401).end()

      const matches = basicAuthRegex.exec(auth)

      if (!matches) return res.status(401).end()

      const userPass = Buffer.from(matches[1], 'base64').toString()

      if (userPass !== `${userName}:${password}`) {
        return res.status(401).end()
      }

      return next()
    } catch (err) {
      next(err)
    }
  }
}
