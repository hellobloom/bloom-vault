import * as express from 'express'
import * as EthU from 'ethereumjs-util'

import {
  apiOnly,
  asyncHandler,
  ipRateLimited,
  adminOnlyHandler,
  createRequestValidator,
  didValidator,
} from '../requestUtils'
import Repo from '../repository'
import regularExpressions from '../regularExpressions'
import {
  ModelValidator,
  ClientFacingError,
  toBoolean,
  recoverEthAddressFromPersonalRpcSig,
} from '../utils'

export const tokenRouter = (app: express.Application) => {
  app.post(
    '/auth/request-token',
    ipRateLimited(20, 'request-token'),
    apiOnly,
    asyncHandler(
      async req => {
        const query = req.query as {did: string; initialize: boolean}
        const validator = new ModelValidator(query, {initialize: true})

        return validator.validate({
          did: didValidator,
          initialize: (_name, value) => toBoolean(value),
        })
      },

      async ({did, initialize}) => {
        return {
          status: 200,
          body: {
            token: await Repo.createAccessToken(did, initialize),
          },
        }
      }
    )
  )

  app.post(
    '/auth/validate-token',
    ipRateLimited(20, 'validate-token'),
    apiOnly,
    asyncHandler(
      async req => {
        const body = req.body as {
          accessToken: string
          signature: string
          did: string
        }
        const validator = new ModelValidator(body)

        return validator.validate({
          accessToken: async (name, value) => {
            const uuidRegex = regularExpressions.auth.uuid
            if (!uuidRegex.test(value)) {
              throw new ClientFacingError(`bad ${name} format`, 400)
            }
            return value
          },
          did: didValidator,
          signature: async (name, value) => {
            try {
              const ethAddress = EthU.bufferToHex(
                recoverEthAddressFromPersonalRpcSig(body.accessToken, value)
              )
              if (ethAddress !== body.did.replace('did:ethr:', '')) {
                throw new ClientFacingError('unauthorized', 401)
              }
              return value
            } catch (err) {
              console.log('validate-token signature validation error')
              console.log(err)
              if (err instanceof ClientFacingError) {
                throw err
              }
              throw new ClientFacingError(`bad ${name} format`, 400)
            }
          },
        })
      },
      async ({accessToken, signature}) => {
        const expiresAt = await Repo.validateAccessToken(accessToken, signature)

        if (!expiresAt) {
          throw new ClientFacingError('unauthorized', 401)
        }
        return {
          status: 200,
          body: {expiresAt},
        }
      }
    )
  )

  const parseDID = createRequestValidator(async req => {
    const query = req.query as {did: string}
    const validator = new ModelValidator(query)

    return validator.validate({
      did: didValidator,
    })
  })

  app.post(
    '/auth/blacklist',
    apiOnly,
    adminOnlyHandler(parseDID, async ({did}) => {
      await Repo.addBlacklist(did)
      return {
        status: 200,
        body: {},
      }
    })
  )

  app.delete(
    '/auth/blacklist',
    apiOnly,
    adminOnlyHandler(parseDID, async ({did}) => {
      await Repo.removeBlacklist(did)
      return {
        status: 200,
        body: {},
      }
    })
  )

  app.post(
    '/auth/admin',
    apiOnly,
    adminOnlyHandler(parseDID, async ({did}) => {
      await Repo.addAdmin(did)
      return {
        status: 200,
        body: {},
      }
    })
  )

  app.delete(
    '/auth/admin',
    apiOnly,
    adminOnlyHandler(parseDID, async ({did}) => {
      await Repo.removeAdmin(did)
      return {
        status: 200,
        body: {},
      }
    })
  )

  app.post(
    '/auth/entity',
    apiOnly,
    adminOnlyHandler(parseDID, async ({did}) => {
      await Repo.addEntity(did)
      return {
        status: 200,
        body: {},
      }
    })
  )
}
