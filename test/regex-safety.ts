import {getBasicAuthRegex} from '../src/requestUtils'
import * as assert from 'assert'
import safe_regex = require('safe-regex')

const url = 'http://localhost:3001'

describe('RegEx', () => {
  it('Basic auth regex is safe', () => {
    const basicAuthRegEx = getBasicAuthRegex()
    assert.equal(safe_regex(basicAuthRegEx), true)
  })
})
