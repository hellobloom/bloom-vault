import * as express from 'express-serve-static-core'
import {apiOnly, asyncHandler, authorized, authenticatedHandler, ClientFacingError, ModelValidator} from '../requestUtils'
import Repo from '../repository'
import * as openpgp from 'openpgp'

export const dataRouter = (app: express.Application) => {

  app.get('/data/me', apiOnly, authenticatedHandler(
    async (req, res, next) => {},
    async ({entity: {fingerprint}}) => {
      const entity = await Repo.getMe(fingerprint)
      const {keys} = await openpgp.key.read(entity.key)
      return {
        status: 200,
        body: {
          pgpKey: keys[0].armor(),
          pgpKeyFingerprint: fingerprint.toString('hex').toUpperCase(),
          dataCount: entity.data_count,
          deletedCount: entity.deleted_count,
        },
      }
    },
  ))

  app.get('/data/:start/:end', apiOnly, authenticatedHandler(
    async (req, res, next) => {
      const body = req.query as { start: number, end: number | undefined }
      const validator = new ModelValidator(body, {end: true})
      return validator.validate(
        {
          start: async (name, value) => {
            if (!value || typeof value !== 'number') { throw new ClientFacingError(`bad ${name} format`) }
            return value
          },
          end: async (name, value) => {
            if (value && typeof value !== 'number') { throw new ClientFacingError(`bad ${name} format`) }
            return value
          },
        },
      )
    },
    async ({entity: {fingerprint}, start, end}) => {
      const entities = await Repo.getData(fingerprint, start, end)
      if (entities.length === 0) return {status: 404, body: {}}
      return {
        status: 200,
        body: await Promise.all(entities.map(async e => {
          const cyphertext = e.cyphertext && (await openpgp.message.read(e.cyphertext))
          return {
            id: e.id,
            cyphertext: cyphertext!.armor(),
          }
        })),
      }
    },
  ))

  app.post('/data', apiOnly, authenticatedHandler(
    async (req, res, next) => {
      const body = req.body as { id: number | undefined, cyphertext: string }
      const validator = new ModelValidator(body, {id: true})
      return validator.validate(
        {
          id: async (name, value) => {
            if (value && typeof value !== 'number') { throw new ClientFacingError(`bad ${name} format`) }
            return value
          },
          cyphertext: async (name, value) => {
            try {
              const message = await openpgp.message.readArmored(value)
              if (message.err) { throw message.err }
              const compressed = message.compress(openpgp.enums.compression.zip)
              const stream = compressed.packets[0].write()
              const bytes = await openpgp.stream.readToEnd(stream)
              return bytes
            } catch (err) {
              throw new ClientFacingError(`bad ${name} format`)
            }
          },
        },
      )
    },
    async ({entity: {fingerprint}, id, cyphertext}) => {
      const newId = await Repo.insertData(fingerprint, cyphertext as any, id)
      if (newId === null) throw new ClientFacingError('id not in sequence')
      return {
        status: 200,
        body: {
          id: newId,
        },
      }
    },
  ))

  app.delete('/data/:start/:end', apiOnly, authenticatedHandler(
    async (req, res, next) => {
      const body = req.query as { start: number, end: number | undefined }
      const validator = new ModelValidator(
        {
          start: req.query.start as number,
          end: req.query.end as number | undefined,
          signatures: req.body as string[] | undefined,
        },
        {end: true, signatures: true},
      )
      return validator.validate(
        {
          start: async (name, value) => {
            if (!value || typeof value !== 'number') { throw new ClientFacingError(`bad ${name} format`) }
            return value
          },
          end: async (name, value) => {
            if (value && typeof value !== 'number') { throw new ClientFacingError(`bad ${name} format`) }
            return value
          },
          signatures: async (name, value, model) => {
            const expectedLength = (model.end || model.start) - model.start + 1
            if (value && value.length !== expectedLength) {
              throw new ClientFacingError(`too many or too few signatures`)
            }
            if (!value) value = []
            const ids = [...Array(expectedLength).keys()].map(i => i + model.start)

            const key = await openpgp.key.read(req.entity.key)

            return {
              signatures: await Promise.all(value.map(async (s, i) => {
                let signature: openpgp.signature.Signature

                try {
                  signature = await openpgp.signature.readArmored(s)
                  if (signature.err) { throw signature.err }
                } catch (err) {
                  throw new ClientFacingError(`bad signature format for id: ${ids[i]}`)
                }

                const verified = await openpgp.verify({
                  signature,
                  message: openpgp.cleartext.fromText(`delete data id ${ids[i]}`),
                  publicKeys: key.keys,
                })

                if (!verified.signatures[0].valid) {
                  throw new ClientFacingError(`invalid signature for id: ${ids[i]}`)
                }

                return signature.write() as Buffer
              })),
              ids,
            }
          },
        },
      )
    },
    async ({entity: {fingerprint}, signatures: {signatures, ids}}) => {
      const result = await Repo.deleteData(fingerprint, ids, signatures)
      if (!result) throw new ClientFacingError('data already deleted')
      return {
        status: 200,
        body:  result,
      }
    },
  ))

  app.get('/data/deletions/:start/:end', apiOnly, authenticatedHandler(
    async (req, res, next) => {
      const body = req.query as { start: number, end: number | undefined }
      const validator = new ModelValidator(
        {
          start: req.query.start as number,
          end: req.query.end as number | undefined,
        },
        {end: true},
      )
      return validator.validate(
        {
          start: async (name, value) => {
            if (!value || typeof value !== 'number') { throw new ClientFacingError(`bad ${name} format`) }
            return value
          },
          end: async (name, value) => {
            if (value && typeof value !== 'number') { throw new ClientFacingError(`bad ${name} format`) }
            return value
          },
        },
      )
    },
    async ({entity: {fingerprint}, start, end}) => {
      const result = await Repo.getDeletions(fingerprint, start, end)
      if (!result) throw new ClientFacingError('data already deleted')
      return {
        status: 200,
        body: await Promise.all(result.map(async r => ({
          id: r.data_id,
          signature: (await openpgp.signature.read(r.signature!)).armor(),
        }))),
      }
    },
  ))
}
