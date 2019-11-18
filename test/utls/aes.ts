import * as crypto from 'crypto'

import {ByteSource} from 'aes-js'
import * as aesjs from 'aes-js'

/**
 * Uses Node's crypto.randomBytes to generate an aes-js ByteSource of type num[]
 */
export const getRandomKey = (keyLength: number = 256): ByteSource => {
  const bytesLen = keyLength / 8
  if ([16, 24, 32].indexOf(bytesLen) === -1) {
    throw new Error(`Invalid keyLength: ${keyLength.toString()}`)
  }

  const nums: number[] = []
  const randBytes = crypto.randomBytes(bytesLen)
  for (const n of randBytes) {
    nums.push(n)
  }
  return nums
}

// This function is only used for test purposes. Not for real data
export const encryptAES = (text: string, key: ByteSource): string => {
  const textBytes = aesjs.utils.utf8.toBytes(text)
  // The counter is optional, and if omitted will begin at 1
  const aesCtr = new aesjs.ModeOfOperation.ctr(key)
  const encryptedBytes = aesCtr.encrypt(textBytes)

  // To print or store the binary data, you may convert it to hex
  const encryptedHex = aesjs.utils.hex.fromBytes(encryptedBytes)
  return encryptedHex
}

export const decryptAES = (encryptedHex: string, key: ByteSource): string => {
  // When ready to decrypt the hex string, convert it back to bytes
  const encryptedBytes = aesjs.utils.hex.toBytes(encryptedHex)

  // The counter mode of operation maintains internal state, so to
  // decrypt a new instance must be instantiated.
  const aesCtr = new aesjs.ModeOfOperation.ctr(key)
  const decryptedBytes = aesCtr.decrypt(encryptedBytes)

  // Convert our bytes back into text
  const decryptedText = aesjs.utils.utf8.fromBytes(decryptedBytes)
  return decryptedText
}
