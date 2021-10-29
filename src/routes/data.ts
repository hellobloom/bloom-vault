import * as express from 'express'
import {env} from '../environment'

import {
  apiOnly,
  authenticatedHandler,
  ipRateLimited,
  noValidatorAuthenticatedHandler,
  EthereumDIDResolver,
} from '../requestUtils'
import Repo from '../repository'
import {
  ModelValidator,
  requiredNumber,
  optionalNumber,
  ClientFacingError,
  udefCoalesce,
  dataDeletionMessage,
  isNotEmpty,
  recoverEthAddressFromPersonalRpcSig,
} from '../utils'

export const dataRouter = (app: express.Application) => {
  app.get(
    '/data/me',
    ipRateLimited(180, 'me'),
    apiOnly,
    noValidatorAuthenticatedHandler(async ({entity: {did}}) => {
      const [entity, cypherIndexes] = await Promise.all([
        Repo.getMe(did),
        Repo.getEncryptedIndexes(did),
      ])
      const didResolveRes = await new EthereumDIDResolver().resolve(entity.did)
      return {
        status: 200,
        body: {
          did: didResolveRes.didDocument,
          dataCount: entity.data_count,
          deletedCount: entity.deleted_count,
          cypherIndexes: cypherIndexes
            .filter((ci) => ci && ci.cypherindex)
            .map((ci) => ({
              cypherindex: ci.cypherindex.toString(),
            })),
        },
      }
    })
  )

  const getData = authenticatedHandler(
    async (req, res, next) => {
      const body = req.params as {
        start: string
        end: string | undefined
      }
      const queryParams = req.query as {
        cypherindex?: string
      }
      const validator = new ModelValidator(
        {...body, ...queryParams},
        {end: true, cypherindex: true}
      )
      return validator.validate({
        start: requiredNumber,
        end: optionalNumber,
        cypherindex: (_name, value) => {
          if (value && typeof value === 'string' && isNotEmpty(value)) {
            return value.split(',').map((v) => Buffer.from(v))
          } else {
            return null
          }
        },
      })
    },
    async ({entity: {did}, start, end, cypherindex}) => {
      const entities = await Repo.getData({did, start, end, cypherindex})
      if (entities.length === 0) return {status: 404, body: {}}
      return {
        status: 200,
        body: entities.map((e) => {
          let cyphertext: string | null = null
          if (e.cyphertext) {
            cyphertext = e.cyphertext.toString()
          }
          const cypherindex = e.cipherindex.filter((i): i is Buffer => i !== null).map((i) => i.toString())
          return {
            id: e.id,
            cyphertext,
            cypherindex,
          }
        }),
      }
    }
  )

  app.get('/data/:start', ipRateLimited(180, 'get-data'), apiOnly, getData)

  app.get('/data/:start/:end', ipRateLimited(180, 'get-data'), apiOnly, getData)

  app.post(
    '/data',
    ipRateLimited(180, 'post-data'),
    apiOnly,
    authenticatedHandler(
      async (req, res, next) => {
        const body = req.body as {
          id: number | undefined
          cyphertext: string
          cypherindex: string | string[]
        }
        const validator = new ModelValidator(body, {id: true, cypherindex: true})
        return validator.validate({
          id: optionalNumber,
          cyphertext: (name, value) => {
            try {
              if (!isNotEmpty(value)) {
                throw new Error(`cyphertext cannot be empty`)
              }
              return Buffer.from(value)
            } catch (err) {
              throw new ClientFacingError(`bad ${name} format`)
            }
          },
          cypherindex: (_name, value) => {
            if (!value) {
              return null
            }
            if (typeof value === 'string' && isNotEmpty(value)) {
              return [Buffer.from(value)]
            }
            if (Array.isArray(value) && value.length) {
              return value.map((v) => Buffer.from(v))
            }
            return null
          },
        })
      },
      async ({entity: {did}, id, cyphertext, cypherindex}) => {
        const logLevel = env.logLevel()
        const newId = await Repo.insertData({did, cyphertext, id, cypherindex})
        if (newId === null) throw new ClientFacingError('id not in sequence')
        if (logLevel == 'debug') {
          console.log({newId})
        }
        return {
          status: 200,
          body: {
            id: newId,
          },
        }
      }
    )
  )

  const deleteData = authenticatedHandler(
    async (req, res, next) => {
      const validator = new ModelValidator(
        {
          start: req.params.start as string,
          end: req.params.end as string | undefined,
          signatures: req.body.signatures as string[] | undefined,
        },
        {end: true, signatures: true}
      )
      return validator.validate({
        start: requiredNumber,
        end: optionalNumber,
        signatures: async (name, value, model) => {
          const expectedLength =
            Number(udefCoalesce(model.end, model.start)) - Number(model.start) + 1
          if (value && value.length !== expectedLength) {
            throw new ClientFacingError(`too many or too few signatures`)
          }
          if (!value) value = []
          const ids = [...Array(expectedLength).keys()]
            .map(Number)
            .map((i) => i + Number(model.start))

          const {did} = req.entity

          return {
            signatures: value.map((s, i) => {
              try {
                const ethAddress = recoverEthAddressFromPersonalRpcSig(
                  dataDeletionMessage(ids[i]),
                  s
                )
                const reqEthAddress = Buffer.from(
                  did.replace('did:ethr:0x', ''),
                  'hex'
                )
                if (Buffer.compare(ethAddress, reqEthAddress) !== 0) {
                  throw new ClientFacingError(`invalid signature for id: ${ids[i]}`)
                }
              } catch (err) {
                console.log('DELETE /data signature validation error')
                console.log(err)
                if (err instanceof ClientFacingError) {
                  throw err
                }
                throw new ClientFacingError(`bad signature format for id: ${ids[i]}`)
              }
              return s
            }),
            ids,
          }
        },
      })
    },
    async ({entity: {did}, signatures: {signatures, ids}}) => {
      return {
        status: 200,
        body: await Repo.deleteData(did, ids, signatures),
      }
    }
  )

  app.delete(
    '/data/:start/:end',
    ipRateLimited(180, 'delete-data'),
    apiOnly,
    deleteData
  )
  app.delete('/data/:start', ipRateLimited(60, 'delete-data'), apiOnly, deleteData)

  const getDeletions = authenticatedHandler(
    async (req, res, next) => {
      const validator = new ModelValidator(
        {
          start: req.params.start as string,
          end: req.params.end as string | undefined,
        },
        {end: true}
      )
      return validator.validate({start: requiredNumber, end: optionalNumber})
    },
    async ({entity: {did}, start, end}) => {
      const result = await Repo.getDeletions(did, start, end)
      return {
        status: 200,
        body: result.map((r) => {
          return {
            id: r.data_id,
            signature: r.signature,
          }
        }),
      }
    }
  )

  app.get(
    '/deletions/:start/:end',
    ipRateLimited(180, 'deletions'),
    apiOnly,
    getDeletions
  )
  app.get('/deletions/:start', ipRateLimited(60, 'deletions'), apiOnly, getDeletions)
}
