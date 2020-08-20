import * as assert from 'assert'
import fetch from 'node-fetch'

const baseUrl = 'http://localhost:3001'
const healthEndpoint = '/api/v1/health'

describe(`The ${healthEndpoint}`, () => {
  it('should return a 200 with a JSON response of {"success": true}.', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      method: 'GET',
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.success, true)
  })
})
