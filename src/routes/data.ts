import * as express from 'express-serve-static-core'
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
import * as EthU from 'ethereumjs-util'

export const dataRouter = (app: express.Application) => {
  app.get(
    '/data/me',
    ipRateLimited(60, 'me'),
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
            .filter(ci => ci && ci.cypherindex)
            .map(ci => ({
              cypherindex: ci.cypherindex.toString(),
            })),
        },
      }
    })
  )

  const getData = authenticatedHandler(
    async (req, res, next) => {
      const body = req.params as {
        start: number
        end: number | undefined
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
            return Buffer.from(value)
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
        body: await Promise.all(
          entities.map(async e => {
            let cyphertext: string | null = null
            if (e.cyphertext) {
              cyphertext = e.cyphertext.toString()
            }
            return {
              id: e.id,
              cyphertext,
            }
          })
        ),
      }
    }
  )

  app.get('/data/:start', ipRateLimited(60, 'get-data'), apiOnly, getData)

  app.get('/data/:start/:end', ipRateLimited(60, 'get-data'), apiOnly, getData)

  app.post(
    '/data',
    ipRateLimited(60, 'post-data'),
    apiOnly,
    authenticatedHandler(
      async (req, res, next) => {
        const body = req.body as {
          id: number | undefined
          cyphertext: string
          cypherindex: string
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
            if (value && typeof value === 'string' && isNotEmpty(value)) {
              return Buffer.from(value)
            } else {
              return null
            }
          },
        })
      },
      async ({entity: {did}, id, cyphertext, cypherindex}) => {
        const newId = await Repo.insertData({did, cyphertext, id, cypherindex})
        if (newId === null) throw new ClientFacingError('id not in sequence')
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
          start: req.params.start as number,
          end: req.params.end as number | undefined,
          signatures: req.body.signatures as string[] | undefined,
        },
        {end: true, signatures: true}
      )
      return validator.validate({
        start: requiredNumber,
        end: optionalNumber,
        signatures: async (name, value, model) => {
          const expectedLength =
            udefCoalesce(model.end, model.start) - model.start + 1
          if (value && value.length !== expectedLength) {
            throw new ClientFacingError(`too many or too few signatures`)
          }
          if (!value) value = []
          const ids = [...Array(expectedLength).keys()]
            .map(Number)
            .map(i => i + model.start)

          const {did} = req.entity

          return {
            signatures: value.map((s, i) => {
              try {
                const ethAddress = EthU.bufferToHex(
                  recoverEthAddressFromPersonalRpcSig(dataDeletionMessage(ids[i]), s)
                )
                if (ethAddress !== did.replace('did:ethr:', '')) {
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
    ipRateLimited(60, 'delete-data'),
    apiOnly,
    deleteData
  )
  app.delete('/data/:start', ipRateLimited(60, 'delete-data'), apiOnly, deleteData)

  const getDeletions = authenticatedHandler(
    async (req, res, next) => {
      const validator = new ModelValidator(
        {
          start: req.params.start as number,
          end: req.params.end as number | undefined,
        },
        {end: true}
      )
      return validator.validate({start: requiredNumber, end: optionalNumber})
    },
    async ({entity: {did}, start, end}) => {
      const result = await Repo.getDeletions(did, start, end)
      return {
        status: 200,
        body: result.map(r => {
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
    ipRateLimited(60, 'deletions'),
    apiOnly,
    getDeletions
  )
  app.get('/deletions/:start', ipRateLimited(60, 'deletions'), apiOnly, getDeletions)
}
