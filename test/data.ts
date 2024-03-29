import * as path from 'path'
require('dotenv').config({
  path: path.join(
    __dirname,
    typeof process.env.TEST_ENV === 'string' ? process.env.TEST_ENV : '../.env.test'
  ),
})
import * as assert from 'assert'
import fetch, {Response} from 'node-fetch'
import {Client} from 'pg'
import {ByteSource} from 'aes-js'
import {v4 as uuidv4} from 'uuid'

import {up, down} from '../migrations'
import * as db from '../database'
import {dataDeletionMessage, udefCoalesce, personalSign} from '../src/utils'
import {getRandomKey, encryptAES, decryptAES} from './utls/aes'

const url = 'http://localhost:3001'

interface IData {
  id: number
  text: string
  type?: string | string[]
}

interface IUser {
  privateKey: string
  did: string
  aesKey: ByteSource
  indexNonce: string
  data: IData[]
  accessToken: string
}

describe('Data', () => {
  let client: Client
  let users: IUser[]
  let firstUserAddress: string
  let firstUser: IUser
  let secondUserAddress: string
  let secondUser: IUser
  let sharedMultiIndex = 'SHARED_MULTI_INDEX'

  async function requestToken(user: IUser, initialize: boolean = false) {
    const response = await fetch(
      `${url}/auth/request-token?did=${user.did}&initialize=${initialize}`,
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
        signature: personalSign(user.accessToken, user.privateKey),
        did: user.did,
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

  async function getData({
    token,
    start,
    end,
    cypherindex,
  }: {
    token: string
    start: number
    end?: number
    cypherindex?: string | string[]
  }) {
    const queryParams = (cypherindex
      ? `?cypherindex=${encodeURIComponent(
          Array.isArray(cypherindex) ? cypherindex.join(',') : cypherindex
        )}`
      : ''
    ).trim()
    return fetch(`${url}/data/${start}/${udefCoalesce(end, '')}${queryParams}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
  }

  async function postData({
    token,
    cyphertext,
    id,
    cypherindex,
  }: {
    token: string
    cyphertext: string
    id?: number
    cypherindex?: string | string[]
  }) {
    return fetch(`${url}/data`, {
      method: 'POST',
      body: JSON.stringify({id, cyphertext, cypherindex}),
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

    // User setup

    firstUserAddress = '0xba35e4f63bce9047464671fcbadbae41509c4b8e'
    firstUser = {
      privateKey:
        '0x6fba3824f0d7fced2db63907faeaa6ffae283c3bf94072e0a3b2940b2b572b65',
      did: `did:ethr:${firstUserAddress}`,
      aesKey: getRandomKey(),
      indexNonce: `${uuidv4()}:${uuidv4()}`,
      data: [
        {id: 0, text: 'user1data0'},
        {id: 1, text: 'user1data1'},
        {id: 2, text: 'user1data2', type: 'user1data2-type-1'},
        {id: 3, text: 'user1data3', type: 'user1data3-type-2'},
        {
          id: 4,
          text: 'user1data4',
          type: ['user1data4-type-1', sharedMultiIndex],
        },
        {
          id: 5,
          text: 'user1data5',
          type: [sharedMultiIndex, 'user1data5-type-1'],
        },
      ],
      accessToken: '',
    }

    secondUserAddress = '0x33fc5b05705b91053e157bc2b2203f17f532f606'
    secondUser = {
      privateKey:
        '0x57db064025480c5c131d4978dcaea1a47246ad33b7c45cf757eac37db1bbe20e',
      did: `did:ethr:${secondUserAddress}`,
      aesKey: getRandomKey(),
      indexNonce: `${uuidv4()}:${uuidv4()}`,
      data: [
        {id: 0, text: 'user2data0'},
        {id: 1, text: 'user2data1'},
        {id: 2, text: 'user2data2'},
        {id: 3, text: 'user2data3', type: 'user2data3-type'},
      ],
      accessToken: '',
    }

    users = [firstUser, secondUser]

    await requestToken(firstUser, true)
    await validateToken(firstUser)

    let response = await fetch(`${url}/debug/set-env/ALLOW_ANONYMOUS/true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${firstUser.accessToken}`,
      },
    })

    await requestToken(secondUser)
    await validateToken(secondUser)

    response = await fetch(`${url}/debug/set-env/ALLOW_ANONYMOUS/false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${firstUser.accessToken}`,
      },
    })
  })

  after(async () => {
    await client.end()
  })

  it('should return the did and 0 for the data and deleted count', async () => {
    for (const user of users) {
      const response = await getMe(user.accessToken)
      const body = await response.json()
      assert.strictEqual(body.did.id, user.did)
      assert.strictEqual(body.dataCount, 0)
      assert.strictEqual(body.deletedCount, 0)
      assert.strictEqual(response.status, 200)
    }
  })

  describe('after spamming an endpoint', async () => {
    let response: Response
    before(async () => {
      for (let i = 0; i < 190; i++) {
        response = await getMe(firstUser.accessToken)
      }
    })

    after(async () => {
      await client.query('delete from ip_call_count;')
    })

    it('should hit a rate limit', () => {
      assert.strictEqual(response.status, 429)
    })
  })

  context('after inserting some data', () => {
    before(async () => {
      for (const user of users) {
        for (const data of user.data) {
          const plaintext = JSON.stringify(data)
          const message = encryptAES(plaintext, user.aesKey)
          const getCypherIndex = (): string[] | undefined => {
            if (typeof data.type === 'undefined') {
              return undefined
            }
            const dataTypes = Array.isArray(data.type) ? data.type : [data.type]
            return dataTypes.map(dt => {
              const plaintextIndex = JSON.stringify({
                nonce: user.indexNonce,
                type: dt,
              })
              const cypherindex = encryptAES(plaintextIndex, user.aesKey)
              return cypherindex
            })
          }

          // only specify the id sometimes to test with or without it
          const requestData = {
            token: user.accessToken,
            cyphertext: message,
            id: data.id % 2 === 0 ? data.id : undefined,
            cypherindex: getCypherIndex(),
          }
          // console.log({requestData})
          const response = await postData(requestData)
          // console.log({response})
        }
      }
    })

    it('should return the number of data objects for each user', async () => {
      for (const user of users) {
        const response = await getMe(user.accessToken)
        const body = await response.json()
        assert.strictEqual(body.dataCount, user.data.length)
        assert.strictEqual(body.deletedCount, 0)
      }
    })

    it('can verify the returned data', async () => {
      const response = await getData({
        token: firstUser.accessToken,
        start: 0,
        end: firstUser.data.length - 1,
      })
      const body = await response.json()
      assert.strictEqual(body[0].id, 0)
      assert.strictEqual(body.length, firstUser.data.length)
      const decrypted = await decryptAES(body[0].cyphertext, firstUser.aesKey)
      const data = JSON.parse(decrypted) as IData
      assert.strictEqual(data.id, firstUser.data[0].id)
      assert.strictEqual(data.text, firstUser.data[0].text)
    })

    it('should not return data outside of the index range', async () => {
      const response = await getData({
        token: firstUser.accessToken,
        start: 0,
        end: firstUser.data.length - 2,
      })
      const body = await response.json()
      assert.strictEqual(body[0].id, 0)
      assert.strictEqual(body.length, firstUser.data.length - 1)
    })
    it('should not return data outside of the index range', async () => {
      const response = await getData({
        token: firstUser.accessToken,
        start: 5,
        end: firstUser.data.length - 2,
      })
      const body = await response.json()
      assert.strictEqual(response.status, 404)
      assert.deepStrictEqual(body, {})
    })

    it('can retrieve data by index and verify it', async () => {
      const indexedData = firstUser.data
        .filter((d) => typeof d.type !== 'undefined')
        .sort((d) => d.id)

      for (const d of indexedData) {
        const dataTypes = Array.isArray(d.type) ? d.type : ([d.type] as string[])
        const cipherindexes: string[] = []

        for (const dt of dataTypes) {
          const plaintextIndex = JSON.stringify({
            nonce: firstUser.indexNonce,
            type: dt,
          })
          const cypherindex = encryptAES(plaintextIndex, firstUser.aesKey)
          cipherindexes.push(cypherindex)
        }

        const response = await getData({
          token: firstUser.accessToken,
          start: d.id,
          cypherindex: cipherindexes,
        })
        const body = await response.json()
        const decrypted = decryptAES(body[0].cyphertext, firstUser.aesKey)
        const data = JSON.parse(decrypted) as IData
        assert.strictEqual(data.id, d.id)
        assert.strictEqual(data.text, d.text)
      }
    })

    it('can retrieve data by a shared index and verify the correlating records', async () => {
      const plaintextIndex = JSON.stringify({
        nonce: firstUser.indexNonce,
        type: sharedMultiIndex,
      })
      const cypherindex = encryptAES(plaintextIndex, firstUser.aesKey)
      const response = await getData({
        token: firstUser.accessToken,
        start: 0,
        end: firstUser.data.length - 1,
        cypherindex,
      })
      const body = await response.json()
      const matchingDataRows = firstUser.data.filter(
        d =>
          Array.isArray(d.type) && d.type.findIndex(t => t === sharedMultiIndex) > -1
      )

      assert.strictEqual(body.length, matchingDataRows.length)

      for (const d of body) {
        const exists = matchingDataRows.findIndex(md => md.id === d.id) > -1
        assert.strictEqual(exists, true)
      }
    })

    it('the indexes returned by /data/me are unique', async () => {
      const me = await (await getMe(firstUser.accessToken)).json()
      const cypherIndexes = me.cypherIndexes as {cypherindex: string}[]

      assert.strictEqual(
        cypherIndexes.length,
        cypherIndexes.filter((ci, idx) => {
          return (
            cypherIndexes.findIndex(c => c.cypherindex === ci.cypherindex) === idx
          )
        }).length
      )
    })

    it('should not return data outside of the index range with the cypherindex', async () => {
      const outsidePlaintextIndex = JSON.stringify({
        nonce: firstUser.indexNonce,
        type: firstUser.data[2].type,
      })
      const outsideCypherindex = encryptAES(outsidePlaintextIndex, firstUser.aesKey)
      const response = await getData({
        token: firstUser.accessToken,
        start: 0,
        cypherindex: outsideCypherindex,
      })
      const body = await response.json()
      assert.strictEqual(response.status, 404)
      assert.deepStrictEqual(body, {})
    })

    it('should not return data outside from another did with the cypherindex', async () => {
      const outsidePlaintextIndex = JSON.stringify({
        nonce: secondUser.indexNonce,
        type: secondUser.data[3].type,
      })
      const outsideCypherindex = encryptAES(outsidePlaintextIndex, secondUser.aesKey)
      const response = await getData({
        token: firstUser.accessToken,
        start: 0,
        cypherindex: outsideCypherindex,
      })
      const body = await response.json()
      assert.strictEqual(response.status, 404)
      assert.deepStrictEqual(body, {})
    })

    it('can get a range of data in order', async () => {
      const response = await getData({
        token: secondUser.accessToken,
        start: secondUser.data.length - 2,
        end: secondUser.data.length - 1,
      })
      const body = (await response.json()) as Array<{id: number; cyphertext: string}>
      assert.strictEqual(body.length, 2)
      body.forEach(async (blob, i) => {
        const expectedId = secondUser.data.length - 2 + i
        const decrypted = await decryptAES(blob.cyphertext, secondUser.aesKey)
        const data = JSON.parse(decrypted) as IData
        assert.strictEqual(expectedId, blob.id)
        assert.strictEqual(expectedId, data.id)
      })
    })

    it('should return 404 if the data does not exist', async () => {
      const response = await getData({
        token: firstUser.accessToken,
        start: firstUser.data.length,
      })
      assert.strictEqual(response.status, 404)
    })

    it('cannot insert data out of order', async () => {
      const message = encryptAES('test', firstUser.aesKey)

      const response = await postData({
        token: firstUser.accessToken,
        cyphertext: message,
        id: firstUser.data.length + 1,
      })
      const body = await response.json()
      assert.strictEqual(response.status, 400)
      assert.strictEqual(body.error, 'id not in sequence')
    })

    it('should not let too few signatures be passed if passed', async () => {
      const signatures: string[] = []

      const response = await deleteData(secondUser.accessToken, 0, {signatures})
      const body = await response.json()
      assert.strictEqual(response.status, 400)
      assert.strictEqual(body.error, 'too many or too few signatures')
    })

    it('should not let a bad signature be used to delete', async () => {
      const id = 0
      const signatures = [
        personalSign(dataDeletionMessage(id + 1), secondUser.privateKey),
      ]

      const response = await deleteData(secondUser.accessToken, id, {signatures})
      const body = await response.json()
      assert.strictEqual(response.status, 400)
      assert.strictEqual(body.error, `invalid signature for id: ${id}`)
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
          [start, end].map(async (id) => {
            return personalSign(dataDeletionMessage(id), secondUser.privateKey)
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
        assert.strictEqual(body.dataCount, secondUser.data.length)
        assert.strictEqual(body.deletedCount, 2)

        response = await getMe(firstUser.accessToken)
        body = await response.json()
        assert.strictEqual(body.dataCount, firstUser.data.length)
        assert.strictEqual(body.deletedCount, 1)
      })

      it('should return expected deletions', async () => {
        let response = await getDeletions(secondUser.accessToken, 0, 1)
        let body = (await response.json()) as Array<{id: number; signature: string}>
        assert.strictEqual(body.length, 2)
        assert.strictEqual(body[0].id, start)
        assert.strictEqual(body[1].id, end)

        response = await getDeletions(firstUser.accessToken, 0)
        body = await response.json()
        assert.strictEqual(body.length, 1)
        assert.strictEqual(body[0].id, 0)
      })

      it('should return null for the data', async () => {
        let response = await getData({token: secondUser.accessToken, start, end})
        let body = (await response.json()) as Array<{id: number; cyphertext: string}>
        assert.strictEqual(body.length, 2)
        assert.strictEqual(body[0].cyphertext, null)
        assert.strictEqual(body[1].cyphertext, null)

        response = await getData({token: firstUser.accessToken, start: 0})
        body = await response.json()
        assert.strictEqual(body.length, 1)
        assert.strictEqual(body[0].cyphertext, null)
      })
    })
  })
})
