import {
  RequestHandler,
  NextFunction,
  Request,
  Response,
} from 'express-serve-static-core'
import Repo, {IEntity} from './repository'
import regularExpressions from './regularExpressions'

export class ClientFacingError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message)
  }
}

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

export type OptionalCheckList<T> = {[P in keyof T]?: boolean}
export type InversePromise<T> = T extends Promise<infer K> ? K : T
export type Validator<T, P extends keyof T, R> = (
  name: P,
  value: T[P],
  model: T
) => Promise<R> | R
export type Validators<T> = {[P in keyof T]: Validator<T, P, any>}
export type Transformed<T, V extends Validators<T>> = {
  [P in keyof T]: InversePromise<ReturnType<V[P]>>
}

export class ModelValidator<T> {
  constructor(public model: T, public allowMissing: OptionalCheckList<T> = {}) {}

  public async validateProp<P extends keyof T, R>(
    name: P,
    callback: Validator<T, P, R>
  ) {
    const value = this.model[name]
    if (!this.allowMissing[name] && value === undefined) {
      throw new ClientFacingError(`missing ${name}`)
    }
    const validated = await callback(name, value, this.model)

    return validated === undefined ? value : validated
  }

  public async validate<V extends Validators<T>>(
    validators: V
  ): Promise<Transformed<T, V>> {
    for (const validator in validators) {
      this.model[validator as keyof T] = await this.validateProp(
        validator as keyof T,
        validators[validator]
      )
    }
    return this.model as Transformed<T, V>
  }
}

type NotUndefined<T> = T extends undefined ? never : T
type ArrayType<T> = T extends Array<infer K> ? K : never

export function notUndefined<T>(value: T): value is NotUndefined<T> {
  if (value === undefined) return false
  return true
}

export function udefCoalesce<T1, T2 extends any[]>(
  value: T1,
  ...replacements: T2
): NotUndefined<T1 | ArrayType<T2>> {
  if (notUndefined(value)) return value
  for (const replacement of replacements) {
    if (notUndefined(replacement)) return replacement
  }
  throw new Error('could not replace value')
}

export function requiredNumber(name: string, value: any) {
  try {
    value = Number(value)
    if (isNaN(value)) throw new Error('')
    return value as number
  } catch (err) {
    throw new ClientFacingError(`bad ${name} format`)
  }
}

export function optionalNumber(name: string, value?: any) {
  return value === undefined ? (value as undefined) : requiredNumber(name, value)
}

export function dataDeletionMessage(id: number) {
  return `delete data id ${id}`
}
