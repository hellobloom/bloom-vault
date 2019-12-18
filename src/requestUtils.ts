import {
  RequestHandler,
  NextFunction,
  Request,
  Response,
} from 'express-serve-static-core'
import Repo, {IEntity} from './repository'
import regularExpressions from './regularExpressions'
import {env} from './environment'
import {ClientFacingError} from './utils'
import {
  IDidResolver,
  IDidResolveResult,
  DidDocument,
  IDidDocument,
  IDidDocumentPublicKey,
} from '@decentralized-identity/did-common-typescript'
import * as EthU from 'ethereumjs-util'

export interface IHandlerResult<T extends object = {}> {
  status: number
  body: T
}

export type RequestValidator<T> = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<T>
export type AuthenticatedRequestValidator<T> = (
  req: Request & {entity: IEntity},
  res: Response,
  next: NextFunction
) => Promise<T>

// this helps typescript infer the types
export function createRequestValidator<T>(validator: RequestValidator<T>) {
  return validator
}

export function asyncHandler<T>(
  validator: RequestValidator<T>,
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
  validator: AuthenticatedRequestValidator<T>,
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

export function adminOnlyHandler<T>(
  validator: RequestValidator<T>,
  handler: (parameters: T & {entity: IEntity}) => Promise<IHandlerResult>
) {
  return authenticatedHandler(validator, async params => {
    if (!(await Repo.isAdmin(params.entity.did))) {
      throw new ClientFacingError('unauthorized', 401)
    }
    return handler(params)
  })
}

export const noValidator = async (_req: Request, _res: Response) => {}

export function noValidatorAuthenticatedHandler(
  handler: (parameters: void & {entity: IEntity}) => Promise<IHandlerResult>
) {
  return authenticatedHandler(noValidator, handler)
}

type TDidDocumentPublicKey = IDidDocumentPublicKey & {ethereumAddress: string}
interface IEthDidDocument extends IDidDocument {
  publicKey?: TDidDocumentPublicKey[]
}
const ethrDidDocumentTmpl = (ethAddress: string): IEthDidDocument => ({
  '@context': 'https://w3id.org/did/v1',
  id: `did:ethr:${ethAddress}`,
  publicKey: [
    {
      id: `did:ethr:${ethAddress}#owner`,
      type: 'Secp256k1VerificationKey2018',
      controller: `did:ethr:${ethAddress}`,
      ethereumAddress: ethAddress,
    },
  ],
  authentication: [
    {
      type: 'Secp256k1SignatureAuthentication2018',
      publicKey: `did:ethr:${ethAddress}#owner`,
    },
  ],
})

/**
 * Simplified "resolver", that just uses a template to avoid unnecessary performance issues.
 */
export class EthereumDIDResolver implements IDidResolver {
  public async resolve(did: string): Promise<IDidResolveResult> {
    if (
      !did.startsWith('did:ethr:') ||
      !EthU.isValidAddress(did.replace('did:ethr:', ''))
    ) {
      throw Error('unable to resolve did document')
    }

    const didDocument = ethrDidDocumentTmpl(did.replace('did:ethr:', ''))
    return {
      didDocument: new DidDocument(didDocument),
    }
  }
}

/**
 * Validates dids by resolving to a did document.
 * Supported formats:
 * - did:ethr:0x...
 */
export async function didValidator(name: string, did: string) {
  try {
    const {didDocument} = await new EthereumDIDResolver().resolve(did)
    return didDocument.id
  } catch (err) {
    console.log(`didValidator error: ${err}`)
    throw new ClientFacingError(`bad ${name} format`)
  }
}

export const apiOnly: RequestHandler = (req, res, next) => {
  if (
    typeof req.body === 'undefined' ||
    (Object.keys(req.body).length === 0 && req.body.constructor === Object)
  ) {
    return next()
  }
  const ct = req.header('Content-Type')
  if (typeof ct === 'string' && ct.trimLeft().startsWith('application/json')) {
    return next()
  } else {
    // 415 = Unsupported media type
    return res.status(415).end()
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
