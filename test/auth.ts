import * as path from 'path'
require('dotenv').config({path: path.join(__dirname, '../.env.debug')})
import * as assert from 'assert'
import fetch, {Response} from 'node-fetch'
import {Client} from 'pg'
import {up, down} from '../migrations'
import * as db from '../database'
import * as openpgp from 'openpgp'
import {env} from '../src/environment'
console.log(`pg pwd: ${process.env.POSTGRES_PASSWORD}`)
const uuid = require('uuidv4')

const url = 'http://localhost:3001'

describe('Auth', async () => {
  let adminPrivateKey: openpgp.key.Key
  let userPrivateKey: openpgp.key.Key
  let adminAccessToken: string
  let client: Client

  before(async () => {
    client = new Client(db.mocha)
    await client.connect()
    await down(db.mocha, false)
    await up(db.mocha, false)

    adminPrivateKey = (await openpgp.generateKey({
      userIds: [{name: 'Jon Smith', email: 'jon@example.com'}],
      curve: 'curve25519',
      // preferred symmetric cypher is aes256 for openPGP.js
    })).key

    userPrivateKey = (await openpgp.generateKey({
      userIds: [{name: 'Jon Smith', email: 'jon@example.com'}],
      curve: 'curve25519',
      // preferred symmetric cypher is aes256 for openPGP.js
    })).key
  })

  after(async () => {
    await client.end()
  })

  it('should return 400 on bad fingerprint format', async () => {
    const badResponse = await fetch(
      `${url}/auth/request-token?fingerprint=${adminPrivateKey.getFingerprint() +
        'A'}`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
      }
    )

    assert.equal(badResponse.status, 400)
  })

  it('should not create an entity if initialize is not passed', async () => {
    const response = await fetch(
      `${url}/auth/request-token?fingerprint=${adminPrivateKey.getFingerprint()}`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
      }
    )

    assert.equal(response.status, 200)

    const result = await client.query(`select count(*) from entities`)

    assert.equal(result.rows[0].count, 0)
  })

  describe('after requesting a token for the first time', async () => {
    let response: Response
    let body: any
    let signed: openpgp.SignResult

    before(async () => {
      response = await fetch(
        `${url}/auth/request-token?fingerprint=${adminPrivateKey.getFingerprint()}&initialize=true`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
        }
      )
      body = await response.json()
      adminAccessToken = body.token

      signed = await openpgp.sign({
        message: openpgp.cleartext.fromText(adminAccessToken),
        privateKeys: [adminPrivateKey],
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
          accessToken: adminAccessToken + 'a',
          signature: signed.signature,
          pgpKey: adminPrivateKey.toPublic().armor(),
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
          accessToken: adminAccessToken,
          signature: 'asdfasdf',
          pgpKey: adminPrivateKey.toPublic().armor(),
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
          accessToken: adminAccessToken,
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
          pgpKey: adminPrivateKey.toPublic().armor(),
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
          accessToken: adminAccessToken,
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
        message: openpgp.cleartext.fromText(adminAccessToken),
        privateKeys: [differentPrivateKey],
        detached: true,
      })

      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken: adminAccessToken,
          signature: badsigned.signature,
          pgpKey: adminPrivateKey.toPublic().armor(),
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
        message: openpgp.cleartext.fromText(adminAccessToken),
        privateKeys: [differentPrivateKey],
        detached: true,
      })

      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken: adminAccessToken,
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
          Authorization: `Bearer ${adminAccessToken}`,
        },
      })

      assert.equal(badResponse.status, 401)
    })

    it('should not create another entity if an different user trys to sign up', async () => {
      const newResponse = await fetch(
        `${url}/auth/request-token?fingerprint=${userPrivateKey.getFingerprint()}`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
        }
      )

      assert.equal(response.status, 200)

      const result = await client.query(`select count(*) from entities`)

      assert.equal(result.rows[0].count, 1)
    })

    describe('after validating the token', async () => {
      before(async () => {
        response = await fetch(`${url}/auth/validate-token`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            accessToken: adminAccessToken,
            signature: signed.signature,
            pgpKey: adminPrivateKey.toPublic().armor(),
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
            accessToken: adminAccessToken,
            signature: signed.signature,
            pgpKey: adminPrivateKey.toPublic().armor(),
          }),
        })

        assert.equal(badResponse.status, 401)
        assert.equal((await badResponse.json()).error, 'unauthorized')
      })

      describe('after setting ALLOW_ANONYMOUS set to true and requesting a new token with a different key', async () => {
        let userAccessToken: string
        let resetResponse: Response

        before(async () => {
          response = await fetch(`${url}/debug/set-env/ALLOW_ANONYMOUS/true`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminAccessToken}`,
            },
          })

          response = await fetch(
            `${url}/auth/request-token?fingerprint=${userPrivateKey.getFingerprint()}`,
            {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
            }
          )
          body = await response.json()
          userAccessToken = body.token

          signed = await openpgp.sign({
            message: openpgp.cleartext.fromText(userAccessToken),
            privateKeys: [userPrivateKey],
            detached: true,
          })

          response = await fetch(`${url}/auth/validate-token`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              accessToken: userAccessToken,
              signature: signed.signature,
              pgpKey: userPrivateKey.toPublic().armor(),
            }),
          })

          response = await fetch(`${url}/data/me`, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${userAccessToken}`,
            },
          })

          resetResponse = await fetch(`${url}/debug/set-env/ALLOW_ANONYMOUS/false`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminAccessToken}`,
            },
          })
        })

        it('should return OK', async () => {
          assert.equal(response.status, 200)
          assert.equal(resetResponse.status, 200)
        })

        it('should not let a non admin add/remove a blacklist', async () => {
          const badResponse = await fetch(
            `${url}/auth/blacklist?fingerprint=${adminPrivateKey.getFingerprint()}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${userAccessToken}`,
              },
            }
          )

          assert.equal(badResponse.status, 401)
        })

        describe('after adding the user as an admin', async () => {
          before(async () => {
            await fetch(
              `${url}/auth/admin?fingerprint=${userPrivateKey.getFingerprint()}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${adminAccessToken}`,
                },
              }
            )
          })

          describe('after the user creates a new entity for his friend', async () => {
            let friendPrivateKey: openpgp.key.Key

            before(async () => {
              friendPrivateKey = (await openpgp.generateKey({
                userIds: [{name: 'Jon Smith', email: 'jon@example.com'}],
                curve: 'curve25519',
                // preferred symmetric cypher is aes256 for openPGP.js
              })).key
              response = await fetch(
                `${url}/auth/entity?fingerprint=${friendPrivateKey.getFingerprint()}`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${userAccessToken}`,
                  },
                }
              )
            })

            it('should return ok', async () => {
              assert.equal(response.status, 200)
            })

            describe('after the friend creates a new token', async () => {
              before(async () => {
                response = await fetch(
                  `${url}/auth/request-token?fingerprint=${friendPrivateKey.getFingerprint()}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${userAccessToken}`,
                    },
                  }
                )
              })

              it('should return ok', async () => {
                assert.equal(response.status, 200)
              })

              it('should have created the access token', async () => {
                const result = await client.query(
                  `select count(*) from access_token where fingerprint = $1::pgp_fingerprint;`,
                  [Buffer.from(friendPrivateKey.getFingerprint(), 'hex')]
                )
                assert.equal(result.rows[0].count, 1)
              })
            })
          })

          describe('after the user removes himself as an admin', async () => {
            before(async () => {
              response = await fetch(
                `${url}/auth/admin?fingerprint=${userPrivateKey.getFingerprint()}`,
                {
                  method: 'DELETE',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${userAccessToken}`,
                  },
                }
              )
            })

            it('should return 200', async () => {
              assert.equal(response.status, 200)
            })

            it('should once again not let be able to create new entities', async () => {
              const fingerprint = '41D96DA752A0725E63DE7E7B98C0723FD785653F'
              const badResponse = await fetch(
                `${url}/auth/blacklist?fingerprint=${fingerprint}`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${userAccessToken}`,
                  },
                }
              )
              assert.equal(badResponse.status, 401)

              const result = await client.query(
                `select count(*) from entities where fingerprint = $1::pgp_fingerprint;`,
                [Buffer.from(fingerprint, 'hex')]
              )

              assert.equal(result.rows[0].count, 0)
            })
          })
        })

        describe('after requesting another token', async () => {
          before(async () => {
            response = await fetch(
              `${url}/auth/request-token?fingerprint=${adminPrivateKey.getFingerprint()}`,
              {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
              }
            )
            body = await response.json()
            adminAccessToken = body.token

            signed = await openpgp.sign({
              message: openpgp.cleartext.fromText(adminAccessToken),
              privateKeys: [adminPrivateKey],
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
                accessToken: adminAccessToken,
                signature: signed.signature,
                pgpKey: adminPrivateKey.toPublic().armor(),
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
                  accessToken: adminAccessToken,
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
                  Authorization: `Bearer ${adminAccessToken}`,
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

            describe('after blacklisting the user fingerprint', async () => {
              before(async () => {
                await fetch(
                  `${url}/auth/blacklist?fingerprint=${userPrivateKey.getFingerprint()}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${adminAccessToken}`,
                    },
                  }
                )
              })

              it('should not be able to access a protected endpoint with blacklisted token', async () => {
                const badResponse = await fetch(`${url}/data/me`, {
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${userAccessToken}`,
                  },
                })
                assert.equal(badResponse.status, 401)
              })

              describe('after unblacklisting the fingerprint', async () => {
                before(async () => {
                  await fetch(
                    `${url}/auth/blacklist?fingerprint=${userPrivateKey.getFingerprint()}`,
                    {
                      method: 'DELETE',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${adminAccessToken}`,
                      },
                    }
                  )
                })

                it('should be able to access a protected endpoint with unblacklisted token', async () => {
                  const goodResponse = await fetch(`${url}/data/me`, {
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${userAccessToken}`,
                    },
                  })
                  assert.equal(goodResponse.status, 200)
                })
              })
            })

            describe('after the token expires', async () => {
              before(async () => {
                await client.query(
                  `update access_token set validated_at = validated_at - ($2 || ' seconds')::interval where uuid = $1;`,
                  [adminAccessToken, env.tokenExpirationSeconds()]
                )
              })

              it('should not be able to access a protected endpoint with an expired token', async () => {
                const badResponse = await fetch(`${url}/data/me`, {
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminAccessToken}`,
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
})
