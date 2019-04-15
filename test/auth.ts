import * as path from 'path'
require('dotenv').config({path: path.join(__dirname, '../.env.debug')})
import * as assert from 'assert'
import fetch, {Response} from 'node-fetch'
import {Client} from 'pg'
import {up, down} from '../migrations'
import * as db from '../database'
import * as openpgp from 'openpgp'
import {env} from '../src/environment'
const uuid = require('uuidv4')

const url = 'http://localhost:3001'

describe('Auth', async () => {
  let privateKey: openpgp.key.Key
  let accessToken: string
  let client: Client

  before(async () => {
    client = new Client(db.mocha)
    await client.connect()
    await down(db.mocha, false)
    await up(db.mocha, false)

    privateKey = (await openpgp.generateKey({
      userIds: [{name: 'Jon Smith', email: 'jon@example.com'}],
      curve: 'curve25519',
      // preferred symmetric cypher is aes256 for openPGP.js
    })).key
  })

  after(async () => {
    await client.end()
  })

  describe('after requesting a new token with no password but ALLOW_ANAYMOUS set to true', async () => {
    let response: Response
    let body: any
    let signed: openpgp.SignResult

    before(async () => {
      await fetch(
        `${url}/debug/set-env/ALLOW_ANONYMOUS/true?password=${env.adminPassword()}`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
        }
      )

      response = await fetch(
        `${url}/auth/request-token?fingerprint=${privateKey.getFingerprint()}`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
        }
      )
      body = await response.json()
      accessToken = body.token

      signed = await openpgp.sign({
        message: openpgp.cleartext.fromText(accessToken),
        privateKeys: [privateKey],
        detached: true,
      })
    })

    after(async () => {
      await fetch(
        `${url}/debug/set-env/ALLOW_ANONYMOUS/false?password=${env.adminPassword()}`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
        }
      )
      const fingerprint = Buffer.from(privateKey.getFingerprint(), 'hex')
      await client.query(
        `
        delete from access_token where fingerprint = $1;
      `,
        [fingerprint]
      )
      await client.query(
        `
        delete from entities where fingerprint = $1;
      `,
        [fingerprint]
      )
    })

    it('should return OK', async () => {
      assert.equal(response.status, 200)
    })

    it('should be able to validate the token', async () => {
      response = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken,
          signature: signed.signature,
          pgpKey: privateKey.toPublic().armor(),
        }),
      })
      assert.equal(response.status, 200)
    })
  })

  it('should return 400 on bad fingerprint format', async () => {
    const badResponse = await fetch(
      `${url}/auth/request-token?fingerprint=${privateKey.getFingerprint() + 'A'}`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
      }
    )

    assert.equal(badResponse.status, 400)
  })

  it('should not let somebody add/remove a blacklist without a valid admin password', async () => {
    let badResponse = await fetch(
      `${url}/auth/blacklist?fingerprint=${privateKey.getFingerprint()}&password=asdfasdf`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
      }
    )

    assert.equal(badResponse.status, 401)

    badResponse = await fetch(
      `${url}/auth/blacklist?fingerprint=${privateKey.getFingerprint()}&password=asdfasdf`,
      {
        method: 'DELETE',
        headers: {'Content-Type': 'application/json'},
      }
    )

    assert.equal(badResponse.status, 401)
  })

  describe('after requesting a new token with no password', async () => {
    let response: Response
    let body: any
    let signed: openpgp.SignResult

    before(async () => {
      response = await fetch(
        `${url}/auth/request-token?fingerprint=${privateKey.getFingerprint()}`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
        }
      )
      body = await response.json()
      accessToken = body.token

      signed = await openpgp.sign({
        message: openpgp.cleartext.fromText(accessToken),
        privateKeys: [privateKey],
        detached: true,
      })
    })

    it('should return OK', async () => {
      assert.equal(response.status, 200)
    })

    it('should not be able to validate the fake token', async () => {
      response = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken,
          signature: signed.signature,
          pgpKey: privateKey.toPublic().armor(),
        }),
      })
      assert.equal(response.status, 401)
    })

    describe('after requesting a new token again with the same key', async () => {
      before(async () => {
        response = await fetch(
          `${url}/auth/request-token?fingerprint=${privateKey.getFingerprint()}`,
          {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
          }
        )
        body = await response.json()
        accessToken = body.token

        signed = await openpgp.sign({
          message: openpgp.cleartext.fromText(accessToken),
          privateKeys: [privateKey],
          detached: true,
        })
      })

      it('should return OK', async () => {
        assert.equal(response.status, 200)
      })

      it('should not be able to validate the fake token', async () => {
        response = await fetch(`${url}/auth/validate-token`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            accessToken,
            signature: signed.signature,
            pgpKey: privateKey.toPublic().armor(),
          }),
        })
        assert.equal(response.status, 401)
      })
    })
  })

  describe('after requesting a new token with the wrong password', async () => {
    let response: Response
    let body: any
    let signed: openpgp.SignResult

    before(async () => {
      response = await fetch(
        `${url}/auth/request-token?fingerprint=${privateKey.getFingerprint()}&password=asdf`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
        }
      )
      body = await response.json()
      accessToken = body.token

      signed = await openpgp.sign({
        message: openpgp.cleartext.fromText(accessToken),
        privateKeys: [privateKey],
        detached: true,
      })
    })

    it('should return OK', async () => {
      assert.equal(response.status, 200)
    })

    it('should not be able to validate the fake token', async () => {
      response = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken,
          signature: signed.signature,
          pgpKey: privateKey.toPublic().armor(),
        }),
      })
      assert.equal(response.status, 401)
    })
  })

  describe('after requesting a token', async () => {
    let response: Response
    let body: any
    let signed: openpgp.SignResult

    before(async () => {
      response = await fetch(
        `${url}/auth/request-token?fingerprint=${privateKey.getFingerprint()}&password=${env.adminPassword()}`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
        }
      )
      body = await response.json()
      accessToken = body.token

      signed = await openpgp.sign({
        message: openpgp.cleartext.fromText(accessToken),
        privateKeys: [privateKey],
        detached: true,
      })
    })

    it('should have returned returned a token', async () => {
      assert.equal(response.status, 200)
    })

    it('should return 400 on bad uuid format', async () => {
      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken: accessToken + 'a',
          signature: signed.signature,
          pgpKey: privateKey.toPublic().armor(),
        }),
      })

      assert.equal(badResponse.status, 400)
      assert.equal((await badResponse.json()).error, 'bad accessToken format')
    })

    it('should return 400 on bad signature format', async () => {
      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken,
          signature: 'asdfasdf',
          pgpKey: privateKey.toPublic().armor(),
        }),
      })

      assert.equal(badResponse.status, 400)
      assert.equal((await badResponse.json()).error, 'bad signature format')
    })

    it('should return 400 on bad pgpKey format', async () => {
      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken,
          signature: signed.signature,
          pgpKey: 'asdfasdfasdf',
        }),
      })

      assert.equal(badResponse.status, 400)
      assert.equal((await badResponse.json()).error, 'bad pgpKey format')
    })

    it('should return 401 on unknown uuid', async () => {
      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken: uuid(),
          signature: signed.signature,
          pgpKey: privateKey.toPublic().armor(),
        }),
      })

      assert.equal(badResponse.status, 401)
      assert.equal((await badResponse.json()).error, 'unauthorized')
    })

    it('should return 401 if no key is passed for a new entity', async () => {
      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken,
          signature: signed.signature,
        }),
      })

      assert.equal(badResponse.status, 401)
      assert.equal((await badResponse.json()).error, 'unauthorized')
    })

    it('should return 401 if signature is invalid', async () => {
      const differentPrivateKey = (await openpgp.generateKey({
        userIds: [{name: 'Jon Smith', email: 'jon@example.com'}],
        curve: 'curve25519',
      })).key

      const badsigned = await openpgp.sign({
        message: openpgp.cleartext.fromText(accessToken),
        privateKeys: [differentPrivateKey],
        detached: true,
      })

      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken,
          signature: badsigned.signature,
          pgpKey: privateKey.toPublic().armor(),
        }),
      })

      assert.equal(badResponse.status, 401)
      assert.equal((await badResponse.json()).error, 'unauthorized')
    })

    it('should return 401 if fingerprint of key passed does not match token', async () => {
      const differentPrivateKey = (await openpgp.generateKey({
        userIds: [{name: 'Jon Smith', email: 'jon@example.com'}],
        curve: 'curve25519',
      })).key

      const badsigned = await openpgp.sign({
        message: openpgp.cleartext.fromText(accessToken),
        privateKeys: [differentPrivateKey],
        detached: true,
      })

      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken,
          signature: badsigned.signature,
          pgpKey: differentPrivateKey.toPublic().armor(),
        }),
      })

      assert.equal(badResponse.status, 401)
      assert.equal((await badResponse.json()).error, 'unauthorized')
    })

    it('should not be able to access a protected endpoint before the token is validated', async () => {
      const badResponse = await fetch(`${url}/data/me`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      })

      assert.equal(badResponse.status, 401)
    })

    describe('after validating the token', async () => {
      before(async () => {
        response = await fetch(`${url}/auth/validate-token`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            accessToken,
            signature: signed.signature,
            pgpKey: privateKey.toPublic().armor(),
          }),
        })
      })

      it('should return OK', async () => {
        assert.equal(response.status, 200)
      })

      it('should return 401 if passing the same key again', async () => {
        const badResponse = await fetch(`${url}/auth/validate-token`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            accessToken,
            signature: signed.signature,
            pgpKey: privateKey.toPublic().armor(),
          }),
        })

        assert.equal(badResponse.status, 401)
        assert.equal((await badResponse.json()).error, 'unauthorized')
      })

      describe('after requesting another token', async () => {
        before(async () => {
          response = await fetch(
            `${url}/auth/request-token?fingerprint=${privateKey.getFingerprint()}`,
            {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
            }
          )
          body = await response.json()
          accessToken = body.token

          signed = await openpgp.sign({
            message: openpgp.cleartext.fromText(accessToken),
            privateKeys: [privateKey],
            detached: true,
          })
        })

        it('should have returned returned a token', async () => {
          assert.equal(response.status, 200)
        })

        it('should have not let the key be passed again', async () => {
          const badResponse = await fetch(`${url}/auth/validate-token`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              accessToken,
              signature: signed.signature,
              pgpKey: privateKey.toPublic().armor(),
            }),
          })

          assert.equal(badResponse.status, 401)
          assert.equal((await badResponse.json()).error, 'unauthorized')
        })

        describe('after validating the second token', async () => {
          before(async () => {
            response = await fetch(`${url}/auth/validate-token`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({
                accessToken,
                signature: signed.signature,
              }),
            })
          })

          it('should have returned returned a token', async () => {
            assert.equal(response.status, 200)
          })

          it('should be able to access a protected endpoint', async () => {
            const goodResponse = await fetch(`${url}/data/me`, {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
            })

            assert.equal(goodResponse.status, 200)
          })

          it('should not be able to access a protected endpoint with a bad token', async () => {
            const badResponse = await fetch(`${url}/data/me`, {
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${uuid()}`,
              },
            })

            assert.equal(badResponse.status, 401)
          })

          describe('after blacklisting the fingerprint', async () => {
            before(async () => {
              await fetch(
                `${url}/auth/blacklist?fingerprint=${privateKey.getFingerprint()}&password=${env.adminPassword()}`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                }
              )
            })

            it('should not be able to access a protected endpoint with blacklisted token', async () => {
              const badResponse = await fetch(`${url}/data/me`, {
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${accessToken}`,
                },
              })
              assert.equal(badResponse.status, 401)
            })

            describe('after unblacklisting the fingerprint', async () => {
              before(async () => {
                await fetch(
                  `${url}/auth/blacklist?fingerprint=${privateKey.getFingerprint()}&password=${env.adminPassword()}`,
                  {
                    method: 'DELETE',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                  }
                )
              })

              it('should be able to access a protected endpoint with unblacklisted token', async () => {
                const badResponse = await fetch(`${url}/data/me`, {
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                  },
                })
                assert.equal(badResponse.status, 200)
              })
            })
          })

          describe('after the token expires', async () => {
            before(async () => {
              await client.query(
                `update access_token set validated_at = validated_at - ($2 || ' seconds')::interval where uuid = $1;`,
                [accessToken, env.tokenExpirationSeconds()]
              )
            })

            it('should not be able to access a protected endpoint with an expired token', async () => {
              const badResponse = await fetch(`${url}/data/me`, {
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${accessToken}`,
                },
              })
              assert.equal(badResponse.status, 401)
            })
          })
        })
      })
    })
  })
})
