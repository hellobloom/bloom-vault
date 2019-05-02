import * as express from 'express-serve-static-core'
import {
  apiOnly,
  asyncHandler,
  ipRateLimited,
  fingerprintValidator,
  adminOnlyHandler,
  RequestValidator,
  createRequestValidator,
} from '../requestUtils'
import Repo from '../repository'
import * as openpgp from 'openpgp'
import regularExpressions from '../regularExpressions'
import {ModelValidator, ClientFacingError, toBoolean, Validator} from '../utils'

export const tokenRouter = (app: express.Application) => {
  app.post(
    '/auth/request-token',
    ipRateLimited(20, 'request-token'),
    apiOnly,
    asyncHandler(
      async (req, res, next) => {
        const query = req.query as {fingerprint: string; initialize: boolean}
        const validator = new ModelValidator(query, {initialize: true})

        return validator.validate({
          fingerprint: fingerprintValidator,
          initialize: (name, value) => toBoolean(value),
        })
      },

      async ({fingerprint, initialize}) => {
        return {
          status: 200,
          body: {
            token: await Repo.createAccessToken(
              Buffer.from(fingerprint, 'hex'),
              initialize
            ),
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
      async (req, res, next) => {
        const body = req.body as {
          accessToken: string
          signature: string
          pgpKey: string
        }
        const validator = new ModelValidator(body, {pgpKey: true})

        return validator.validate({
          accessToken: async (name, value) => {
            const uuidRegex = regularExpressions.auth.uuid
            if (!uuidRegex.test(value)) {
              throw new ClientFacingError(`bad ${name} format`)
            }
            return value
          },
          signature: async (name, value) => {
            try {
              const sig = await openpgp.signature.readArmored(value)
              if (sig.err) {
                throw sig.err
              }
              return sig
            } catch (err) {
              throw new ClientFacingError(`bad ${name} format`)
            }
          },
          pgpKey: async (name, value) => {
            try {
              if (value) {
                const key = await openpgp.key.readArmored(value)
                if (key.err) {
                  throw key.err
                }
                return key
              }
              return undefined
            } catch (err) {
              throw new ClientFacingError(`bad ${name} format`)
            }
          },
        })
      },

      async ({accessToken, pgpKey, signature}) => {
        const newKey = !!pgpKey
        // if its not included get it from the database
        const entity = await Repo.getEntity(accessToken)

        if (!entity) {
          // entity should exist already
          throw new ClientFacingError('unauthorized', 401)
        }
        if (entity.blacklisted) {
          // if they pass a key there should not be a key yet
          throw new ClientFacingError('unauthorized', 401)
        }
        if (pgpKey && entity.key) {
          // if they pass a key there should not be a key yet
          throw new ClientFacingError('unauthorized', 401)
        }
        if (!pgpKey) {
          if (!entity.key) {
            // if they dont pass a key there should already be an entity with a key
            throw new ClientFacingError('unauthorized', 401)
          }
          pgpKey = await openpgp.key.read(entity.key)
        }
        if (entity.fingerprint.toString('hex') !== pgpKey.keys[0].getFingerprint()) {
          throw new ClientFacingError('unauthorized', 401)
        }

        const verified = await openpgp.verify({
          signature,
          message: openpgp.cleartext.fromText(accessToken),
          publicKeys: pgpKey.keys,
        })

        if (!verified.signatures[0].valid) {
          throw new ClientFacingError('unauthorized', 401)
        }

        const expiresAt = await Repo.validateAccessToken(
          accessToken,
          newKey ? pgpKey.keys[0].toPacketlist().write() : undefined
        )

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

  const parseFingerprint = createRequestValidator(async (req, res, next) => {
    const query = req.query as {fingerprint: string}
    const validator = new ModelValidator(query)

    return validator.validate({
      fingerprint: fingerprintValidator,
    })
  })

  app.post(
    '/auth/blacklist',
    apiOnly,
    adminOnlyHandler(parseFingerprint, async ({fingerprint}) => {
      await Repo.addBlacklist(Buffer.from(fingerprint, 'hex'))
      return {
        status: 200,
        body: {},
      }
    })
  )

  app.delete(
    '/auth/blacklist',
    apiOnly,
    adminOnlyHandler(parseFingerprint, async ({fingerprint}) => {
      await Repo.removeBlacklist(Buffer.from(fingerprint, 'hex'))
      return {
        status: 200,
        body: {},
      }
    })
  )

  app.post(
    '/auth/admin',
    apiOnly,
    adminOnlyHandler(parseFingerprint, async ({fingerprint}) => {
      await Repo.addAdmin(Buffer.from(fingerprint, 'hex'))
      return {
        status: 200,
        body: {},
      }
    })
  )

  app.delete(
    '/auth/admin',
    apiOnly,
    adminOnlyHandler(parseFingerprint, async ({fingerprint}) => {
      await Repo.removeAdmin(Buffer.from(fingerprint, 'hex'))
      return {
        status: 200,
        body: {},
      }
    })
  )

  app.post(
    '/auth/entity',
    apiOnly,
    adminOnlyHandler(parseFingerprint, async ({fingerprint}) => {
      await Repo.addEntity(Buffer.from(fingerprint, 'hex'))
      return {
        status: 200,
        body: {},
      }
    })
  )
}
