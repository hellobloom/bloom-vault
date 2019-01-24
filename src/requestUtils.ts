import {RequestHandler, NextFunction, Request, Response} from 'express-serve-static-core'
import Repo, { IEntity } from './repository'

export class ClientFacingError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message)
  }
}

export interface IHandlerResult<T extends object = {}> {
  status: number,
  body: T
}

export function asyncHandler<T>(
  validator: (req: Request, res: Response , next: NextFunction) => Promise<T>,
  handler: (parameters: T) => Promise<IHandlerResult>,
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
  validator: (req: AuthenticatedRequest, res: Response , next: NextFunction) => Promise<T>,
  handler: (parameters: T & {entity: IEntity}) => Promise<IHandlerResult>,
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

export const apiOnly: RequestHandler = (req, res, next) => {
  if (req.header('Content-Type') === 'application/json') {
    next()
  } else {
    // 415 = Unsupported media type
    res.status(415).end()
  }
}

type AuthenticatedRequest = Request & {entity: IEntity}

export const authorized: RequestHandler = async (req: AuthenticatedRequest, res, next) => {
  try {
    const basicAuthRegex = /^(?:Bearer) ([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
    const auth = req.header('Authorization')

    if (!auth) return res.status(401).end()

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

export type OptionalCheckList<T> = {[P in keyof T]?: boolean}
export type InversePromise<T> = T extends Promise<infer K> ? K : T
export type Validator<T, P extends keyof T, R> = (name: P, value: T[P], model: T) => Promise<R>
export type Validators<T> = {[P in keyof T]: Validator<T, P, any>}
export type Transformed<T, V extends Validators<T>> = {[P in keyof T]: InversePromise<ReturnType<V[P]>>}

export class ModelValidator<T> {
  constructor(
    public model: T,
    public allowMissing: OptionalCheckList<T> = {},
  ) {}

  public async validateProp<P extends keyof T, R>(
    name: P,
    callback?: Validator<T, P, R>,
  ) {
    const value = this.model[name]
    if (!this.allowMissing[name] && !value) {
      throw new ClientFacingError(`missing ${name}`)
    }

    if (!value) return value
    if (!callback) return value

    const validated = await callback(name, value, this.model)

    return validated || value
  }

  public async validate<V extends Validators<T>>(validators: V): Promise<Transformed<T, V>> {
    const validated = {} as Transformed<T, V>
    for (const validator in validators) {
      validated[validator as keyof T] = await this.validateProp(validator as keyof T, validators[validator])
    }
    return validated
  }
}
