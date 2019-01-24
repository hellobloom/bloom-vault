import * as path from 'path'
require('dotenv').config({path: path.join(__dirname, '../.env.debug')})
import * as assert from 'assert'
import fetch, { Response } from 'node-fetch'
import { Client } from 'pg'
import {up, down} from '../migrations'
import * as db from '../database'
import * as openpgp from 'openpgp'

const url = 'http://localhost:3001'

interface IData {
  id: number,
  text: string
}

interface IUser {
  key: openpgp.key.Key,
  data: IData[]
  accessToken: string
}

describe('Data', () => {
  let client: Client
  let users: IUser[]
  let firstUser: IUser
  let secondUser: IUser

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

  async function getData(token: string, start: number, end?: number) {
    return fetch(`${url}/data/${start}/${end === undefined ? '' : end}`, {
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

    firstUser = {
      key: (await openpgp.generateKey({
        userIds: [{ name: 'Jon Smith' }],
        curve: 'curve25519',
      })).key,
      data: [
        {id: 0, text: 'user0data1'},
      ],
      accessToken: ''
    }

    secondUser = {
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

    it('can verify the returned data', async () => {
      const response = await getData(firstUser.accessToken, 0)
      const body = await response.json()
      assert.equal(body[0].id, 0)
      assert.equal(body.length, 1)
      const decrypted = await openpgp.decrypt({
        message: await openpgp.message.readArmored(body[0].cyphertext),
        publicKeys: [firstUser.key.toPublic()],
        privateKeys: [firstUser.key]
      })
      const plaintext = await openpgp.stream.readToEnd(decrypted.data as string)
      const data = JSON.parse(plaintext) as IData
      assert.equal(data.id, firstUser.data[0].id)
      assert.equal(data.text, firstUser.data[0].text)
      assert.equal(decrypted.signatures[0].valid, true)
    })
  })
})
