import {RequestHandler, NextFunction, Request, Response} from 'express-serve-static-core'

export class ClientFacingError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message)
  }
}

export interface HandlerResult {
  status: number,
  body: any
}

export function asyncHandler<T>(
  validator:(req: Request, res: Response , next: NextFunction) => Promise<T>,
  handler: (parameters: T) => Promise<HandlerResult>
){
  return async(req: Request, res: Response, next: NextFunction) => {
    try {
      const parameters = await validator(req, res, next)
      const result = await handler(parameters)
      res.status(result.status).json(result.body)
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

export type OptionalCheckList<T> = {[P in keyof T]?: boolean}
export type InversePromise<T> = T extends Promise<infer K> ? K : T
export type Validator<T, P extends keyof T, R> = (name: P, value: T[P]) => Promise<R>
export type Validators<T> = {[P in keyof T]: Validator<T, P, any>}
export type Transformed<T, V extends Validators<T>> = {[P in keyof T]: InversePromise<ReturnType<V[P]>>}

export class ModelValidator<T> {
  constructor(
    public model: T, 
    public allowMissing: OptionalCheckList<T> = {},
  ) {}

  async validateProp<P extends keyof T, R>(
    name: P,
    callback?: Validator<T, P, R>
  ) {
    let value = this.model[name]
    if (!this.allowMissing[name] && !value) {
      throw new ClientFacingError(`missing ${name}`)
    }

    if (!value) return value
    if (!callback) return value

    const validated = await callback(name, value)

    return validated || value
  }

  async validate<V extends Validators<T>>(validators: V): Promise<Transformed<T, V>> {
    const validated = {} as Transformed<T, V>
    for(const validator in this.model) {
      validated[validator] = await this.validateProp(validator, validators[validator])
    }
    return validated
  }
}
