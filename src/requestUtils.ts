import {
  RequestHandler,
  NextFunction,
  Request,
  Response,
} from 'express-serve-static-core'
import Repo, {IEntity} from './repository'
import regularExpressions from './regularExpressions'
import {env} from './environment'

export interface IHandlerResult<T extends object = {}> {
  status: number
  body: T
}

export function asyncHandler<T>(
  validator: (req: Request, res: Response, next: NextFunction) => Promise<T>,
  handler: (parameters: T) => Promise<IHandlerResult>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parameters = await validator(req, res, next)
      const result = await handler(parameters)
      res.status(result.status).json(result.body)
    } catch (err) {
      return next(err)
    }
  }
}

export function authenticatedHandler<T>(
  validator: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<T>,
  handler: (parameters: T & {entity: IEntity}) => Promise<IHandlerResult>
) {
  return [
    authorized,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const parameters = await validator(req, res, next)
        const result = await handler({...parameters, entity: req.entity})
        res.status(result.status).json(result.body)
      } catch (err) {
        return next(err)
      }
    },
  ]
}

export const noValidator = async (_req: Request, _res: Response) => {}

export function noValidatorAuthenticatedHandler(
  handler: (parameters: void & {entity: IEntity}) => Promise<IHandlerResult>
) {
  return authenticatedHandler(noValidator, handler)
}

export const apiOnly: RequestHandler = (req, res, next) => {
  if (req.header('Content-Type') === 'application/json') {
    next()
  } else {
    // 415 = Unsupported media type
    res.status(415).end()
  }
}

export const adminOnly: RequestHandler = (req, res, next) => {
  if (req.query.password === env.adminPassword()) {
    next()
  } else {
    res.status(401).end()
  }
}

type AuthenticatedRequest = Request & {entity: IEntity}

export const authorized: RequestHandler = async (
  req: AuthenticatedRequest,
  res,
  next
) => {
  try {
    const auth = req.header('Authorization')
    if (!auth) return res.status(401).end()

    const basicAuthRegex = regularExpressions.requestUtils.basicAuth
    const matches = basicAuthRegex.exec(auth)

    if (!matches) return res.status(401).end()

    const entity = await Repo.checkAccessToken(matches[1])

    if (!entity) {
      return res.status(401).end()
    }

    req.entity = entity

    return next()
  } catch (err) {
    next(err)
  }
}

export function ipRateLimited(
  maxPerMinute: number,
  endpoint: string
): RequestHandler {
  return async (req, res, next) => {
    try {
      const disable = env.disableRateLimiting()
      if (disable) return next()
      const count = await Repo.updateCallCount(req.ip, endpoint)
      if (count > maxPerMinute) {
        console.log('IP rate limited violation')
        return res.status(429).end()
      }
      return next()
    } catch (err) {
      next(err)
    }
  }
}
