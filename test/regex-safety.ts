import * as assert from 'assert'
import safe_regex = require('safe-regex')
import regularExpressions from '../src/regularExpressions'

const url = 'http://localhost:3001'

describe('RegEx', () => {
  it('Basic auth regular expression is safe', () => {
    assert.equal(safe_regex(regularExpressions.requestUtils.basicAuth), true)
  })

  it('Auth uuid regular expression is safe', () => {
    assert.equal(safe_regex(regularExpressions.auth.uuid), true)
  })

  it('Fingerprint regular expressions are safe', () => {
    const fingerPrintRegExps = regularExpressions.auth.fingerprint
    for (const regExPropKey in fingerPrintRegExps) {
      const regex = fingerPrintRegExps[regExPropKey]
      assert.equal(safe_regex(regex), true)
    }
  })
})
