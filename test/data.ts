import * as path from 'path'
require('dotenv').config({path: path.join(__dirname, '../.env.debug')})
import * as assert from 'assert'
import fetch, {Response} from 'node-fetch'
import {Client} from 'pg'
import {up, down} from '../migrations'
import * as db from '../database'
import * as openpgp from 'openpgp'
import {dataDeletionMessage, udefCoalesce} from '../src/requestUtils'

const url = 'http://localhost:3001'

interface IData {
  id: number
  text: string
}

interface IUser {
  key: openpgp.key.Key
  data: IData[]
  accessToken: string
}

describe('Data', () => {
  let client: Client
  let users: IUser[]
  let firstUser: IUser
  let secondUser: IUser

  async function requestToken(user: IUser) {
    const response = await fetch(
      `${url}/auth/request-token?fingerprint=${user.key.getFingerprint()}`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
      }
    )
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
        Authorization: `Bearer ${token}`,
      },
    })
  }

  async function getData(token: string, start: number, end?: number) {
    return fetch(`${url}/data/${start}/${udefCoalesce(end, '')}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
  }

  async function postData(token: string, cyphertext: string, id?: number) {
    return fetch(`${url}/data`, {
      method: 'POST',
      body: JSON.stringify({id, cyphertext}),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
  }

  async function deleteData(
    token: string,
    start: number,
    opts: {signatures?: string[]; end?: number} = {}
  ) {
    return fetch(`${url}/data/${start}/${udefCoalesce(opts.end, '')}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        signatures: opts.signatures,
      }),
    })
  }

  async function getDeletions(token: string, start: number, end?: number) {
    return fetch(`${url}/deletions/${start}/${udefCoalesce(end, '')}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
        userIds: [{name: 'Jon Smith'}],
        curve: 'curve25519',
      })).key,
      data: [{id: 0, text: 'user0data0'}, {id: 1, text: 'user0data1'}],
      accessToken: '',
    }

    secondUser = {
      key: (await openpgp.generateKey({
        userIds: [{name: 'Jon Doe'}],
        curve: 'curve25519',
      })).key,
      data: [
        {id: 0, text: 'user1data0'},
        {id: 1, text: 'user1data1'},
        {id: 2, text: 'user1data2'},
      ],
      accessToken: '',
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

  describe('after spamming an endpoint', async () => {
    let response: Response
    before(async () => {
      for (let i = 0; i < 60; i++) {
        response = await getMe(firstUser.accessToken)
      }
    })

    after(async () => {
      await client.query('delete from ip_call_count;')
    })

    it('should hit a rate limit', () => {
      assert.equal(response.status, 429)
    })
  })

  context('after inserting some data', () => {
    before(async () => {
      for (const user of users) {
        for (const data of user.data) {
          const plaintext = JSON.stringify(data)
          const message = (await openpgp.encrypt({
            message: openpgp.message.fromText(plaintext),
            publicKeys: [user.key.toPublic()],
            privateKeys: [user.key],
          })) as openpgp.EncryptArmorResult

          // only specify the id sometimes to test with or without it
          await postData(
            user.accessToken,
            message.data,
            data.id % 2 === 0 ? data.id : undefined
          )
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
      const response = await getData(
        firstUser.accessToken,
        0,
        firstUser.data.length - 1
      )
      const body = await response.json()
      assert.equal(body[0].id, 0)
      assert.equal(body.length, firstUser.data.length)
      const decrypted = await openpgp.decrypt({
        message: await openpgp.message.readArmored(body[0].cyphertext),
        publicKeys: [firstUser.key.toPublic()],
        privateKeys: [firstUser.key],
      })
      const plaintext = await openpgp.stream.readToEnd(decrypted.data as string)
      const data = JSON.parse(plaintext) as IData
      assert.equal(data.id, firstUser.data[0].id)
      assert.equal(data.text, firstUser.data[0].text)
      assert.equal(decrypted.signatures[0].valid, true)
    })

    it('can get a range of data in order', async () => {
      const response = await getData(
        secondUser.accessToken,
        secondUser.data.length - 2,
        secondUser.data.length - 1
      )
      const body = (await response.json()) as Array<{id: number; cyphertext: string}>
      assert.equal(body.length, 2)
      body.forEach(async (blob, i) => {
        const exptectedId = secondUser.data.length - 2 + i
        const decrypted = await openpgp.decrypt({
          message: await openpgp.message.readArmored(blob.cyphertext),
          publicKeys: [secondUser.key.toPublic()],
          privateKeys: [secondUser.key],
        })
        const plaintext = await openpgp.stream.readToEnd(decrypted.data as string)
        const data = JSON.parse(plaintext) as IData
        assert.equal(exptectedId, blob.id)
        assert.equal(exptectedId, data.id)
      })
    })

    it('should return 404 if the data does not exist', async () => {
      const response = await getData(firstUser.accessToken, firstUser.data.length)
      assert.equal(response.status, 404)
    })

    it('cannot insert data out of order', async () => {
      const message = (await openpgp.encrypt({
        message: openpgp.message.fromText('test'),
        publicKeys: [firstUser.key.toPublic()],
        privateKeys: [firstUser.key],
      })) as openpgp.EncryptArmorResult

      const response = await postData(
        firstUser.accessToken,
        message.data,
        firstUser.data.length + 1
      )
      const body = await response.json()
      assert.equal(response.status, 400)
      assert.equal(body.error, 'id not in sequence')
    })

    it('cannot insert malformed cyphertext', async () => {
      const malformedData = 'ThisIsNotCyphertext'
      const response = await postData(firstUser.accessToken, malformedData, firstUser.data.length)
      const body = await response.json()
      assert.equal(response.status, 400)
      assert.equal(body.error, 'bad cyphertext format')
    })

    it('should not let too few signatures be passed if passed', async () => {
      const signatures: string[] = []

      const response = await deleteData(secondUser.accessToken, 0, {signatures})
      const body = await response.json()
      assert.equal(response.status, 400)
      assert.equal(body.error, 'too many or too few signatures')
    })

    it('should not let a bad signature be used to delete', async () => {
      const id = 0
      const signatures = [
        (await openpgp.sign({
          message: openpgp.cleartext.fromText(dataDeletionMessage(id + 1)),
          privateKeys: [secondUser.key],
          detached: true,
        })).signature as string,
      ]

      const response = await deleteData(secondUser.accessToken, id, {signatures})
      const body = await response.json()
      assert.equal(response.status, 400)
      assert.equal(body.error, `invalid signature for id: ${id}`)
    })

    context('after deleting some data', () => {
      let start: number
      let end: number

      before(async () => {
        // delete the first data for user1
        await deleteData(firstUser.accessToken, 0)

        // delete the last 2 data for user2 with signatures
        start = secondUser.data.length - 2
        end = secondUser.data.length - 1
        const signatures = await Promise.all(
          [start, end].map(async id => {
            return (await openpgp.sign({
              message: openpgp.cleartext.fromText(dataDeletionMessage(id)),
              privateKeys: [secondUser.key],
              detached: true,
            })).signature as string
          })
        )

        await deleteData(secondUser.accessToken, start, {
          end,
          signatures,
        })
      })

      it('should update deleted count for the users', async () => {
        let response = await getMe(secondUser.accessToken)
        let body = await response.json()
        assert.equal(body.dataCount, secondUser.data.length)
        assert.equal(body.deletedCount, 2)

        response = await getMe(firstUser.accessToken)
        body = await response.json()
        assert.equal(body.dataCount, firstUser.data.length)
        assert.equal(body.deletedCount, 1)
      })

      it('should return validatable deletion signatures', async () => {
        let response = await getDeletions(secondUser.accessToken, 0, 1)
        let body = (await response.json()) as Array<{id: number; signature: string}>
        assert.equal(body.length, 2)
        assert.equal(body[0].id, start)
        assert.equal(body[1].id, end)

        for (const deletion of body) {
          const verified = await openpgp.verify({
            signature: await openpgp.signature.readArmored(deletion.signature),
            message: openpgp.cleartext.fromText(dataDeletionMessage(deletion.id)),
            publicKeys: [secondUser.key.toPublic()],
          })
          assert.equal(verified.signatures[0].valid, true)
        }

        response = await getDeletions(firstUser.accessToken, 0)
        body = await response.json()
        assert.equal(body.length, 1)
        assert.equal(body[0].id, 0)
      })

      it('should return null for the data', async () => {
        let response = await getData(secondUser.accessToken, start, end)
        let body = (await response.json()) as Array<{id: number; cyphertext: string}>
        assert.equal(body.length, 2)
        assert.equal(body[0].cyphertext, null)
        assert.equal(body[1].cyphertext, null)

        response = await getData(firstUser.accessToken, 0)
        body = await response.json()
        assert.equal(body.length, 1)
        assert.equal(body[0].cyphertext, null)
      })
    })
  })
})
