import * as path from 'path'
require('dotenv').config({path: path.join(__dirname, '../.env.debug')})
import * as assert from 'assert'
import fetch, { Response } from 'node-fetch'
import { Client } from 'pg'
import {up, down} from '../migrations'
import * as db from '../database'
import * as openpgp from 'openpgp'

const url = 'http://localhost:3001'

interface IUser {
  key: openpgp.key.Key,
  data: Array<{
    id: number,
    text: string
  }>,
  accessToken: string
}

describe('Data', () => {
  let client: Client
  let users: IUser[]

  async function requestToken(user: IUser) {
    const response = await fetch(`${url}/auth/request-token?fingerprint=${user.key.getFingerprint()}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
    })
    const body = await response.json()
    user.accessToken = body.token
  }

  async function validateToken(user: IUser) {
    const response = await fetch(`${url}/auth/validate-token`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        accessToken: user.accessToken,
        signature: (await openpgp.sign({
          message: openpgp.cleartext.fromText(user.accessToken),
          privateKeys: [user.key],
          detached: true,
        })).signature,
        pgpKey: user.key.toPublic().armor(),
      }),
    })
  }

  async function getMe(token: string) {
    return fetch(`${url}/data/me`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })
  }

  before(async () => {
    client = new Client(db.mocha)
    await client.connect()
    await down(db.mocha, false)
    await up(db.mocha, false)

    const firstUser = {
      key: (await openpgp.generateKey({
        userIds: [{ name: 'Jon Smith' }],
        curve: 'curve25519',
      })).key,
      data: [
        {id: 0, text: 'user0data1'},
      ],
      accessToken: ''
    }

    const secondUser = {
      key: (await openpgp.generateKey({
        userIds: [{ name: 'Jon Doe' }],
        curve: 'curve25519',
      })).key,
      data: [
        {id: 0, text: 'user1data0'},
        {id: 1, text: 'user1data1'},
        {id: 2, text: 'user1data2'},
      ],
      accessToken: ''
    }

    users = [firstUser, secondUser]

    for (const user of users) {
      await requestToken(user)
      await validateToken(user)
    }
  })

  after(async () => {
    await client.end()
  })

  it('should return the pgp key and 0 for the data and deleted count', async () => {
    for (const user of users) {
      const response = await getMe(user.accessToken)
      const body = await response.json()
      assert.equal(body.pgpKey, user.key.toPublic().armor())
      assert.equal(body.pgpKeyFingerprint, user.key.getFingerprint().toUpperCase())
      assert.equal(body.dataCount, 0)
      assert.equal(body.deletedCount, 0)
      assert.equal(response.status, 200)
    }
  })

  context('after inserting some data', () => {
    before(async () => {
      for (const user of users) {
        for (const data of user.data) {
          const plaintext = JSON.stringify(data)
          const message = await openpgp.encrypt({
            message: openpgp.message.fromText(plaintext),
            publicKeys: [user.key.toPublic()],
            privateKeys: [user.key]
          }) as openpgp.EncryptArmorResult

          const response = await fetch(`${url}/data`, {
            method: 'POST',
            body: JSON.stringify({
              id: data.id,
              cyphertext: message.data
            }),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${user.accessToken}`,
            },
          })
        }
      }
    })

    it('should return the number of data objects for each user', async () => {
      for (const user of users) {
        const response = await getMe(user.accessToken)
        const body = await response.json()
        assert.equal(body.dataCount, user.data.length)
        assert.equal(body.deletedCount, 0)
      }
    })
  })
})
