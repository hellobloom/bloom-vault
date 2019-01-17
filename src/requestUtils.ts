import {RequestHandler, NextFunction, Request, Response} from 'express-serve-static-core'

export class ClientFacingError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

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

export type StringList<T> = {[P in keyof T]: string[]}
export type OptionalCheckList<T> = {[P in keyof T]?: boolean}

export class ModelValidator<T> {
  errors: Partial<StringList<T>> = {}
  hasErrors: boolean

  constructor(public model: T, public allowMissing: OptionalCheckList<T> = {}) {}

  async validateProp<P extends keyof T>(
    name: P,
    callback?: (name: keyof T, value: T[P], errors: string[]) => Promise<T[P] | void>
  ) {
    let value = this.model[name]
    if (!this.allowMissing[name] && !value) this.addError(name, `missing ${name}`)

    if (!value) return value
    if (!callback) return value

    const errors: string[] = []
    const validated = await callback(name, value, errors)

    for (let error of errors) {
      this.addError(name, error)
    }
    return validated || value
  }

  addError(prop: keyof T, error: string) {
    if (!this.errors[prop]) this.errors[prop as string] = []
    this.hasErrors = true
    this.errors[prop as string] = this.errors[prop]!.concat(error)
  }
}
