import * as express from 'express-serve-static-core'
import {apiOnly, asyncHandler, ClientFacingError, ModelValidator} from '../requestUtils'
import Repo from '../repository';
const openpgp = require('openpgp');

export const tokenRouter = (app: express.Application) => {
  
  app.post('/auth/request-token', apiOnly, asyncHandler(async (req, res, next) => {
    const query = req.query as { fingerprint: string }
    const validator = new ModelValidator(query)

    const fingerprint = await validator.validateProp('fingerprint', async (name, value, errors) => {
      value = value.replace(new RegExp('-', 'g'), '')
      value = value.replace(new RegExp(':', 'g'), '')
      value = value.replace('0x', '')
      const match = new RegExp('^[a-fA-F0-9]{40}$').exec(value)
      if(!match) errors.push(`bad ${name} format`)
      return value
    })

    if (validator.hasErrors) throw new ClientFacingError(validator.errors[0], 400)

    const token = await Repo.createAccessToken(Buffer.from(fingerprint, 'hex'))
    res.status(200).json({token})
  }))

  app.post('/auth/validate-token', apiOnly, asyncHandler(async (req, res, next) => {
    const body = req.body as {
      accessToken: string,
      signature: string,
      pgpKey: string
    }
    const validator = new ModelValidator(body, {pgpKey: true})
    let signature: any
    let pgpKey: any

    await validator.validateProp('accessToken', async (name, value, errors) => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(value)) errors.push(`bad ${name} format`)
    })

    await validator.validateProp('signature', async (name, value, errors) => {
      try {
        signature = await openpgp.signature.readArmored(value)
      }
      catch(err) {
        errors.push(`bad ${name} format`)
      }
    })

    await validator.validateProp('pgpKey', async (name, value, errors) => {
      try {
        pgpKey = await openpgp.key.readArmored(value)
      }
      catch(err) {
        errors.push(`bad ${name} format`)
      }
    })

    // show client facing errors
    if (validator.hasErrors) throw new ClientFacingError(validator.errors[0], 400)
    
    // if its not included get it from the database
    const entity = await Repo.getEntity(body.accessToken)

    if(!entity) {
      // entity should exist already
      throw new ClientFacingError('unauthorized', 401)
    }
    if(pgpKey && entity.key) {
      // if they pass a key there should not be a key yet
      throw new ClientFacingError('unauthorized', 401)
    }
    if(!pgpKey) {
      if(!entity.key) {
        // if they dont pass a key there should already be an entity with a key
        throw new ClientFacingError('unauthorized', 401)
      }
      pgpKey = await openpgp.key.read(entity.key)
    }

    const verified = await openpgp.verify({
      signature,
      message: openpgp.cleartext.fromText(body.accessToken),
      publicKeys: pgpKey.keys
    })

    if(!verified.signatures[0].valid) {
      throw new ClientFacingError('unauthorized', 401)
    }

    const expiresAt = await Repo.validateAccessToken(body.accessToken)
    
    if(!expiresAt) {
      throw new ClientFacingError('unauthorized', 401)
    }

    res.status(200).json({token: body.accessToken, expiresAt})
  }))
}
