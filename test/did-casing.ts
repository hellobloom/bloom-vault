import * as path from 'path'
require('dotenv').config({
  path: path.join(
    __dirname,
    typeof process.env.TEST_ENV === 'string' ? process.env.TEST_ENV : '../.env.test'
  ),
})
console.log('ALLOW_ANONYMOUS=' + process.env.ALLOW_ANONYMOUS)
import * as assert from 'assert'
import fetch from 'node-fetch'
import {Client} from 'pg'
// import {ByteSource} from 'aes-js'
// import {v4 as uuidv4} from 'uuid'

import {up, down} from '../migrations'
import * as db from '../database'
// import {dataDeletionMessage, udefCoalesce, personalSign} from '../src/utils'
import {getRandomKey /*, encryptAES, decryptAES*/} from './utls/aes'
import {personalSign} from '../src/utils'

const url = 'http://localhost:3001'

type TUser = {
  privateKey: string
  did: string
  accessToken: string
}

async function requestToken(user: TUser, initialize: boolean = false) {
  const response = await fetch(
    `${url}/auth/request-token?did=${user.did}&initialize=${initialize}`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
    }
  )
  const body = await response.json()
  user.accessToken = body.token
  return body
}

async function validateToken(user: TUser) {
  const response = await fetch(`${url}/auth/validate-token`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      accessToken: user.accessToken,
      signature: personalSign(user.accessToken, user.privateKey),
      did: user.did,
    }),
  })
  return response.json()
}

// async function getMe(token: string) {
//   const response = await fetch(`${url}/data/me`, {
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${token}`,
//     },
//   })
//   return response.json()
// }

describe('DID Casing Tests', () => {
  let client: Client
  const privateKey =
    '0xbc37e4fef90096ea38ec859fa67cf29bf6bf63d099ba345c134c915d1cfbf3b5'
  const address = '062de159DFA582245712deFCaea2FCd2dCaA3B55'
  const aesKey = getRandomKey()

  const user = {
    admin: {
      aesKey: getRandomKey(),
      did: `did:ethr:0x686669c5cC1c60352253637787787f6a022ABEa2`,
      privateKey: `0xd79e484cfd962bd26cd194ee185663c74b52cf841f69b7eafeb27ed46c22d44e`,
      accessToken: '',
    },
    different: {
      aesKey: getRandomKey(),
      did: `did:ethr:0x2aA9c9139f9Efb53019D75Dc6d5b2c0a7f50722f`,
      privateKey:
        '0xb4e988f0637edc258fe9b2304c11f6af433dc281482322d160d239be880995be',
      accessToken: '',
    },

    // should be same user
    standard: {
      aesKey,
      did: `did:ethr:0x${address}`,
      privateKey,
      accessToken: '',
    },
    uppercased: {
      aesKey,
      did: `did:ethr:0x${address.toUpperCase()}`,
      privateKey,
      accessToken: '',
    },
    lowercased: {
      aesKey,
      did: `did:ethr:0x${address.toLowerCase()}`,
      privateKey,
      accessToken: '',
    },
  }

  before(async () => {
    client = new Client(db.mocha)
    await client.connect()
    await down(db.mocha, true)
    await up(db.mocha, true)

    // Sets ALLOW_ANONYMOUS to true so the tests can focus on casing differences
    await requestToken(user.admin, true)
    await validateToken(user.admin)
    await fetch(`${url}/debug/set-env/ALLOW_ANONYMOUS/true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.admin.accessToken}`,
      },
    })
  })

  after(async () => {
    await client.end()
  })

  it(`Should have 1 non-admin entity upon requesting a token for each different casing of the same user (standard, upper, and lower), but end in 2 non-admin entities when the different user requests a token.`, async () => {
    await requestToken(user.standard)
    let entitiesCountQueryRes = await client.query(
      `select count(did) from entities where admin = 'f'`
    )
    await validateToken(user.standard)
    assert.strictEqual(parseInt(entitiesCountQueryRes.rows[0].count, 10), 1)

    await requestToken(user.uppercased)
    entitiesCountQueryRes = await client.query(
      `select count(did) from entities where admin = 'f'`
    )
    await validateToken(user.uppercased)
    assert.strictEqual(parseInt(entitiesCountQueryRes.rows[0].count, 10), 1)

    await requestToken(user.lowercased)
    entitiesCountQueryRes = await client.query(
      `select count(did) from entities where admin = 'f'`
    )
    await validateToken(user.lowercased)
    assert.strictEqual(parseInt(entitiesCountQueryRes.rows[0].count, 10), 1)

    await requestToken(user.different)
    entitiesCountQueryRes = await client.query(
      `select count(did) from entities where admin = 'f'`
    )
    await validateToken(user.different)
    assert.strictEqual(parseInt(entitiesCountQueryRes.rows[0].count, 10), 2)
  })

  // TODO: ADD SOME data_encrypted_indexes and think about down migration with casing in mind...
})
