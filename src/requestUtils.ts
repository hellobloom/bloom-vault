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
import {Resolver} from 'did-resolver'
import {
  IDidResolver,
  IDidResolveResult,
  DidDocument,
  IDidDocument,
  IDidDocumentPublicKey,
} from '@decentralized-identity/did-common-typescript'
const EthrDidResolver = require('ethr-did-resolver')

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

/**
 * DID Resolver that outputs a properly formatted did:ethr:0x... did document
 * by wrapping the functionality of ethr-did-resolver and did-resolver packages
 * to output the types @decentralized-identity/did-common-typescript that are
 * more aligned with the current specs.
 */
export class EthereumDIDResolver implements IDidResolver {
  public async resolve(did: string): Promise<IDidResolveResult> {
    const ethrDidResolver = EthrDidResolver.getResolver({
      rpcUrl: env.web3Provider(),
      // web3: {
      //   currentProvider: env.web3Provider(),
      // },
      // TODO: Should we deploy an ethr-did-registry contract for Bloom IDs?
      // You can also set an address for your own ethr-did-registry contract
      // registry: env.registryAddress
    })
    const resolver = new Resolver(ethrDidResolver)
    const resolvedDidDocument = await resolver.resolve(did)
    if (!resolvedDidDocument) {
      throw Error('unable to resolve did document')
    }

    const pubKeys: IDidDocumentPublicKey[] = resolvedDidDocument.publicKey.map(
      p => ({
        ...p,
        controller: p.owner,
      })
    )
    const didDocument: IDidDocument = {
      id: resolvedDidDocument.id,
      '@context': resolvedDidDocument['@context'],
      authentication: resolvedDidDocument.authentication,
      publicKey: pubKeys,
      service: resolvedDidDocument.service,
    }
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
