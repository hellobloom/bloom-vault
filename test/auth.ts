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
import {up, down} from '../migrations'
import * as db from '../database'
import {env} from '../src/environment'
import {personalSign} from '../src/utils'
import uuidv4 from 'uuidv4'

const url = 'http://localhost:3001'

describe('Auth', async () => {
  let adminPrivateKey: string
  let adminAddress: string
  let adminDid: string
  let adminAccessToken: string
  let userPrivateKey: string
  let userAddress: string
  let userDid: string
  let client: Client

  before(async () => {
    client = new Client(db.mocha)
    await client.connect()
    await down(db.mocha, false)
    await up(db.mocha, false)

    adminPrivateKey =
      '0x6fba3824f0d7fced2db63907faeaa6ffae283c3bf94072e0a3b2940b2b572b65'
    adminAddress = '0xba35e4f63bce9047464671fcbadbae41509c4b8e'
    adminDid = `did:ethr:${adminAddress}`
    userPrivateKey =
      '0x57db064025480c5c131d4978dcaea1a47246ad33b7c45cf757eac37db1bbe20e'
    userAddress = '0x33fc5b05705b91053e157bc2b2203f17f532f606'
    userDid = `did:ethr:${userAddress}`
  })

  after(async () => {
    await client.end()
  })

  it('should return 400 on bad did format', async () => {
    const badResponse = await fetch(
      `${url}/auth/request-token?did=${adminDid + 'A'}`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
      }
    )

    assert.equal(badResponse.status, 400)
  })

  it('should not create an entity if initialize is not passed', async () => {
    const response = await fetch(`${url}/auth/request-token?did=${adminDid}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
    })
    assert.equal(response.status, 200)

    const result = await client.query(`select count(*) from entities`)
    assert.strictEqual(parseInt(result.rows[0].count, 10), 0)
  })

  describe('after requesting a token for the first time', async () => {
    let response: Response
    let body: any
    let signature: string

    before(async () => {
      response = await fetch(
        `${url}/auth/request-token?did=${adminDid}&initialize=true`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
        }
      )
      body = await response.json()
      adminAccessToken = body.token

      signature = personalSign(adminAccessToken, adminPrivateKey)
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
          signature,
          did: adminDid,
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
          did: adminDid,
        }),
      })

      assert.equal(badResponse.status, 400)
      assert.equal((await badResponse.json()).error, 'bad signature format')
    })

    it('should return 400 on bad did format', async () => {
      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken: adminAccessToken,
          signature,
          did: 'asdfasdfasdf',
        }),
      })

      assert.equal(badResponse.status, 400)
      assert.equal((await badResponse.json()).error, 'bad did format')
    })

    it('should return 401 on unknown uuid', async () => {
      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken: uuidv4(),
          signature,
          did: adminDid,
        }),
      })

      assert.equal(badResponse.status, 401)
      assert.equal((await badResponse.json()).error, 'unauthorized')
    })

    // TODO: Discuss test
    it('should return 400 if no did is passed for validate-token', async () => {
      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken: adminAccessToken,
          signature,
        }),
      })

      assert.equal(badResponse.status, 400)
      assert.equal((await badResponse.json()).error, 'missing did')
    })

    it('should return 401 if signature is invalid', async () => {
      const badSignature = personalSign(
        adminAccessToken,
        '0x192197a2979231078848ec643dae5f0cd96ac19f4ed1b86d1fe857ce6d04c51d'
      )

      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken: adminAccessToken,
          signature: badSignature,
          did: adminDid,
        }),
      })
      assert.equal(badResponse.status, 401)
      assert.equal((await badResponse.json()).error, 'unauthorized')
    })

    it('should return 401 if did of key passed does not match token', async () => {
      const diffDid = 'did:ethr:0xe6f8bff681505f5ae812ee5aca755469bbfde525'

      const badResponse = await fetch(`${url}/auth/validate-token`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          accessToken: adminAccessToken,
          signature,
          did: diffDid,
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
      const newResponse = await fetch(`${url}/auth/request-token?did=${userDid}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
      })

      assert.equal(newResponse.status, 200)

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
            signature,
            did: adminDid,
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
            signature,
            did: adminDid,
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

          response = await fetch(`${url}/auth/request-token?did=${userDid}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
          })
          body = await response.json()
          userAccessToken = body.token

          signature = personalSign(userAccessToken, userPrivateKey)
          response = await fetch(`${url}/auth/validate-token`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              accessToken: userAccessToken,
              signature,
              did: userDid,
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
          const badResponse = await fetch(`${url}/auth/blacklist?did=${adminDid}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${userAccessToken}`,
            },
          })

          assert.equal(badResponse.status, 401)
        })

        describe('after adding the user as an admin', async () => {
          before(async () => {
            await fetch(`${url}/auth/admin?did=${userDid}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminAccessToken}`,
              },
            })
          })

          describe('after the user creates a new entity for his friend', async () => {
            let friendPrivateKey: string
            let friendAddress: string
            let friendDid: string

            before(async () => {
              friendPrivateKey =
                'ee0aa74c226c769c5afe8d3cf5559d3963832e1f987ac6e8ab4e513b2b72c18c'
              friendAddress = '0x95e7717b69f9ed45fb5f939d5b17f64b52840166'
              friendDid = `did:ethr:${friendAddress}`
              response = await fetch(`${url}/auth/entity?did=${friendDid}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${userAccessToken}`,
                },
              })
            })

            it('should return ok', async () => {
              assert.equal(response.status, 200)
            })

            describe('after the friend creates a new token', async () => {
              before(async () => {
                response = await fetch(
                  `${url}/auth/request-token?did=${friendDid}`,
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
                  `select count(*) from access_token where did = $1::text;`,
                  [friendDid]
                )
                assert.equal(result.rows[0].count, 1)
              })
            })
          })

          describe('after the user removes himself as an admin', async () => {
            before(async () => {
              response = await fetch(`${url}/auth/admin?did=${userDid}`, {
                method: 'DELETE',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${userAccessToken}`,
                },
              })
            })

            it('should return 200', async () => {
              assert.equal(response.status, 200)
            })

            it('should once again not let be able to create new entities', async () => {
              const did = 'did:ethr:0x1b777c767e9f787ec3575ef15261b5691b0c9ffc'
              const badResponse = await fetch(`${url}/auth/blacklist?did=${did}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${userAccessToken}`,
                },
              })
              assert.equal(badResponse.status, 401)

              const result = await client.query(
                `select count(*) from entities where did = $1::text;`,
                [did]
              )

              assert.equal(result.rows[0].count, 0)
            })
          })
        })

        describe('after requesting another token', async () => {
          before(async () => {
            response = await fetch(`${url}/auth/request-token?did=${adminDid}`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
            })
            body = await response.json()
            adminAccessToken = body.token
            signature = personalSign(adminAccessToken, adminPrivateKey)
          })

          it('should have returned returned a token', async () => {
            assert.equal(response.status, 200)
          })

          describe('after validating the second token', async () => {
            before(async () => {
              response = await fetch(`${url}/auth/validate-token`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                  accessToken: adminAccessToken,
                  signature,
                  did: adminDid,
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
                  Authorization: `Bearer ${uuidv4()}`,
                },
              })

              assert.equal(badResponse.status, 401)
            })

            describe('after blacklisting the user did', async () => {
              before(async () => {
                await fetch(`${url}/auth/blacklist?did=${userDid}`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminAccessToken}`,
                  },
                })
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

              describe('after unblacklisting the did', async () => {
                before(async () => {
                  await fetch(`${url}/auth/blacklist?did=${userDid}`, {
                    method: 'DELETE',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${adminAccessToken}`,
                    },
                  })
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
