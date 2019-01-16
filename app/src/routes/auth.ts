import * as express from 'express-serve-static-core'
import {apiOnly, asyncHandler, ClientFacingError} from '../requestUtils'
import Repo from '../repository';

function validateFingerprint(fingerprint: string) {
  if(!fingerprint) throw new ClientFacingError('fingerprint is required as a query string parameter')
  fingerprint = fingerprint.replace(new RegExp('-', 'g'), '')
  fingerprint = fingerprint.replace(new RegExp(':', 'g'), '')
  fingerprint = fingerprint.replace('0x', '')
  const match = new RegExp('^[a-fA-F0-9]{40}$').exec(fingerprint)
  if(!match){
    throw new ClientFacingError('invalid fingerprint format')
  }

  return Buffer.from(fingerprint, 'hex')
}

export const tokenRouter = (app: express.Application) => {
  
  app.post('/auth/request-token', apiOnly, asyncHandler(async (req, res, next) => {
    const token = await Repo.createAccessToken(validateFingerprint(req.query.fingerprint))
    res.status(200).json({token})
  }))

  app.post('/auth/authorize-token', apiOnly, asyncHandler(async (req, res, next) => {
    res.status(200).json({token: 'asdf', expiresAt: 1})
  }))
}
