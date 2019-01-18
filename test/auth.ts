import * as assert from 'assert'
import fetch, { Response } from 'node-fetch'
import { Client } from 'pg'
import {up, down} from '../migrations/migrations'
import * as db from '../database'
const openpgp = require('openpgp');

const url = 'http://localhost:3001'

describe('Auth', async () => {
  let privateKey: any
  let accessToken: string
  let client: Client
  
  before(async () => {
    client = new Client(db.mocha)
    await client.connect()
    await down(db.mocha, false)
    await up(db.mocha, false)

    privateKey = (await openpgp.key.readArmored(`
-----BEGIN PGP PRIVATE KEY BLOCK-----
Version: OpenPGP.js v4.4.5
Comment: https://openpgpjs.org

xYYEXED+jxYJKwYBBAHaRw8BAQdA/hK4/5IJg5LiToHYNxMKLSGWTGzMa+nM
eDssq19cnUH+CQMItAUK6e9KT+bgPlObjpG1TevGc9aVo+adTBeUqOcr8rDA
BqFz6lFWQeGInapSP7ET3+uKs10iX1L0WZ/ewGfvOOM7/EfEgd/eKwxxMOZV
dM0bSm9uIFNtaXRoIDxqb25AZXhhbXBsZS5jb20+wncEEBYKAB8FAlxA/o8G
CwkHCAMCBBUICgIDFgIBAhkBAhsDAh4BAAoJEC3I+2Xo/ZRXCRUA/jwuAa4I
PcU5D3fFZaBJxu6yJfsjuEjU05A/I8MZQfX7AQCl6xmk9iseH2ovpxASLWur
TVty6ZT5SfjLfHzSHjjQB8eLBFxA/o8SCisGAQQBl1UBBQEBB0D4PgttGBQc
LzfyrFxs1hWSJnx6m7g9YlP6Alc1F0kiIgMBCAf+CQMI2JKC5PqcEdvg5vDy
M/jhd+YcDUmvE7lnJ8JoyfpdAkc0XJJ0JlWJW6CiHCsHlUfU+hGgGX5lI4Xf
MazxloMM5canxfiOds1AKFW+TEmuTMJhBBgWCAAJBQJcQP6PAhsMAAoJEC3I
+2Xo/ZRXM/wA/AvoW4No4T5zNH8AEkbF7/Z+o7+AcBlmd63pdFEhOeoXAP9p
+SBXAj+RmTS38CK/cyD5ycB0BPTz1buAPCF0lAxFBA==
=0oDL
-----END PGP PRIVATE KEY BLOCK-----
`
    )).keys[0]

    await privateKey.decrypt('12345')
  })

  after(async () => {
    await client.end()
  })

  beforeEach(async () => {
    
  })

  describe('after requesting a new token', async () => {
    let response: Response
    
    before(async() => {
      response = await fetch(`${url}/auth/request-token?fingerprint=${privateKey.getFingerprint()}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'}
      })
    })
    
    it('should return OK', async () => {
      assert.equal(response.status, 200);
      accessToken = (await response.json()).token
    });

    describe('after validating the token', async () => {
      before(async() => {
        const signed = await openpgp.sign({
          message: openpgp.cleartext.fromText(accessToken),
          privateKeys: [privateKey],
          detached: true
        })
  
        response = await fetch(`${url}/auth/validate-token`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            accessToken,
            signature: signed.signature,
            pgpKey: privateKey.toPublic().armor()
          })
        })
      })

      it('should return OK', async () => {
        assert.equal(response.status, 200);
      });
    })
  });
});