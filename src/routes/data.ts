import * as express from 'express-serve-static-core'
import {
  apiOnly,
  authenticatedHandler,
  ClientFacingError,
  ModelValidator,
  requiredNumber,
  optionalNumber,
  dataDeletionMessage,
  udefCoalesce
} from '../requestUtils'
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

  const getData = authenticatedHandler(
    async (req, res, next) => {
      const body = req.params as { start: number, end: number | undefined }
      const validator = new ModelValidator(body, {end: true})
      return validator.validate({start: requiredNumber, end: optionalNumber})
    },
    async ({entity: {fingerprint}, start, end}) => {
      const entities = await Repo.getData(fingerprint, start, end)
      if (entities.length === 0) return {status: 404, body: {}}
      return {
        status: 200,
        body: await Promise.all(entities.map(async e => {
          let cyphertext: string | null = null
          if (e.cyphertext) {
            const array = new Uint8Array(e.cyphertext)
            const message = await openpgp.message.read(array)
            const stream = await message.armor()
            cyphertext = await openpgp.stream.readToEnd(stream)
          }
          return {
            id: e.id,
            cyphertext,
          }
        })),
      }
    },
  )

  app.get('/data/:start', apiOnly, getData)

  app.get('/data/:start/:end', apiOnly, getData)

  app.post('/data', apiOnly, authenticatedHandler(
    async (req, res, next) => {
      const body = req.body as { id: number | undefined, cyphertext: string }
      const validator = new ModelValidator(body, {id: true})
      return validator.validate(
        {
          id: optionalNumber,
          cyphertext: async (name, value) => {
            try {
              // const message = await openpgp.message.readArmored(value)
              // if (message.err) { throw message.err }
              // const compressed = message.compress(openpgp.enums.compression.zip)
              // const stream = compressed.packets.write()
              // const bytes = await openpgp.stream.readToEnd(stream)
              // return bytes

              const message = await openpgp.message.readArmored(value) as any
              if (message.err) { throw message.err }
              const stream = message.packets.write()
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
      const newId = await Repo.insertData(fingerprint, cyphertext, id)
      if (newId === null) throw new ClientFacingError('id not in sequence')
      return {
        status: 200,
        body: {
          id: newId,
        },
      }
    },
  ))

  const deleteData = authenticatedHandler(
    async (req, res, next) => {
      const validator = new ModelValidator(
        {
          start: req.params.start as number,
          end: req.params.end as number | undefined,
          signatures: req.body.signatures as string[] | undefined,
        },
        {end: true, signatures: true},
      )
      return validator.validate(
        {
          start: requiredNumber,
          end: optionalNumber,
          signatures: async (name, value, model) => {
            const expectedLength = udefCoalesce(model.end, model.start) - model.start + 1
            if (value && value.length !== expectedLength) {
              throw new ClientFacingError(`too many or too few signatures`)
            }
            if (!value) value = []
            const ids = [...Array(expectedLength).keys()].map(Number).map(i => i + model.start)

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
                  message: openpgp.cleartext.fromText(dataDeletionMessage(ids[i])),
                  publicKeys: key.keys,
                })

                if (!verified.signatures[0].valid) {
                  throw new ClientFacingError(`invalid signature for id: ${ids[i]}`)
                }

                const stream = signature.packets.write()
                return await openpgp.stream.readToEnd(stream)
              })),
              ids,
            }
          },
        },
      )
    },
    async ({entity: {fingerprint}, signatures: {signatures, ids}}) => {
      return {
        status: 200,
        body: await Repo.deleteData(fingerprint, ids, signatures),
      }
    },
  )

  app.delete('/data/:start/:end', apiOnly, deleteData)
  app.delete('/data/:start', apiOnly, deleteData)

  const getDeletions = authenticatedHandler(
    async (req, res, next) => {
      const validator = new ModelValidator(
        {
          start: req.params.start as number,
          end: req.params.end as number | undefined,
        },
        {end: true},
      )
      return validator.validate({start: requiredNumber, end: optionalNumber})
    },
    async ({entity: {fingerprint}, start, end}) => {
      const result = await Repo.getDeletions(fingerprint, start, end)
      return {
        status: 200,
        body: await Promise.all(result.map(async r => {
          let signature: string | null = null
          if (r.signature) {
            signature = (await openpgp.signature.read(r.signature)).armor()
          }
          return {
            id: r.data_id,
            signature
          }
        })),
      }
    },
  )

  app.get('/deletions/:start/:end', apiOnly, getDeletions)
  app.get('/deletions/:start', apiOnly, getDeletions)
}
