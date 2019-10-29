import * as EthU from 'ethereumjs-util'
import * as wallet from 'ethereumjs-wallet'

const sleep = (miliseconds: number) =>
  new Promise(resolve => setTimeout(resolve, miliseconds))

// this can be used as a sort of async worker that lives within the same process
export async function attempt<T>(
  callback: () => Promise<T>,
  attempts: number = 1,
  errorDelayMs: number = 0,
  delayedStartMs: number = 0
): Promise<T> {
  await sleep(delayedStartMs)
  try {
    const result = await callback()
    return result
  } catch (error) {
    if (attempts === 1) throw error
    await sleep(errorDelayMs)
    return attempt(callback, attempts - 1, errorDelayMs)
  }
}

export type OptionalCheckList<T> = {[P in keyof T]?: boolean}

export type InversePromise<T> = T extends Promise<infer K> ? K : T

export type Validator<Model, Prop extends keyof Model, Return> = (
  name: Prop,
  value: Model[Prop],
  model: Model
) => Promise<Return> | Return

export type ValidatorSet<Model> = {
  [Prop in keyof Model]: Validator<Model, Prop, any>
}

export type ValidatedModel<Model, Validators extends ValidatorSet<Model>> = {
  [Prop in keyof Model]: InversePromise<ReturnType<Validators[Prop]>>
}

export class ModelValidator<T> {
  constructor(public model: T, public allowMissing: OptionalCheckList<T> = {}) {}

  public async validateProp<P extends keyof T, R>(
    name: P,
    callback: Validator<T, P, R>
  ) {
    const value = this.model[name]
    if (!this.allowMissing[name] && value === undefined) {
      throw new ClientFacingError(`missing ${name}`)
    }
    const validated = await callback(name, value, this.model)

    return validated === undefined ? value : validated
  }

  public async validate<V extends ValidatorSet<T>>(
    validators: V
  ): Promise<ValidatedModel<T, V>> {
    for (const validator in validators) {
      this.model[validator as keyof T] = await this.validateProp(
        validator as keyof T,
        validators[validator]
      )
    }
    return this.model as ValidatedModel<T, V>
  }
}

export class ClientFacingError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message)
  }
}

type NotUndefined<T> = T extends undefined ? never : T
type ArrayType<T> = T extends Array<infer K> ? K : never

export function notUndefined<T>(value: T): value is NotUndefined<T> {
  if (value === undefined) return false
  return true
}

export function udefCoalesce<T1, T2 extends any[]>(
  value: T1,
  ...replacements: T2
): NotUndefined<T1 | ArrayType<T2>> {
  if (notUndefined(value)) return value
  for (const replacement of replacements) {
    if (notUndefined(replacement)) return replacement
  }
  throw new Error('could not replace value')
}

export function requiredNumber(name: string, value: any) {
  try {
    value = Number(value)
    if (isNaN(value)) throw new Error('')
    return value as number
  } catch (err) {
    throw new ClientFacingError(`bad ${name} format`)
  }
}

export function optionalNumber(name: string, value?: any) {
  return value === undefined ? (value as undefined) : requiredNumber(name, value)
}

export function dataDeletionMessage(id: number) {
  return `delete data id ${id}`
}

export function toBoolean(value?: string | boolean) {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null) return false
  if (['true', 'True', 'TRUE'].indexOf(value) !== -1) return true
  if (Number(value) === 1) return true
  return false
}

function recoverEthAddressFromDigest(digest: Buffer, rpcSig: string): Buffer {
  // Extract the signature parts so we can recover the public key
  const sigParts = EthU.fromRpcSig(rpcSig)
  // Recover public key from the hash of the message we constructed and the signature the user provided
  const recoveredPubkey = EthU.ecrecover(digest, sigParts.v, sigParts.r, sigParts.s)
  // Convert the recovered public key into the corresponding ethereum address
  const recoveredAddress = wallet.fromPublicKey(recoveredPubkey).getAddressString()
  const zerox = '0x'
  return new Buffer(
    recoveredAddress.startsWith(zerox)
      ? recoveredAddress.substring(zerox.length)
      : recoveredAddress,
    'hex'
  )
}

export function recoverEthAddressFromPersonalRpcSig(
  signedText: string,
  rpcSig: string
): Buffer {
  // Hash the text the same way web3 does with the weird "Ethereum Signed Message" text
  const hashed = EthU.hashPersonalMessage(EthU.toBuffer(signedText))

  return recoverEthAddressFromDigest(hashed, rpcSig)
}

export function personalSign(message: string, privateKey: string) {
  const sig = EthU.ecsign(
    EthU.hashPersonalMessage(EthU.toBuffer(message)),
    EthU.toBuffer(privateKey)
  )

  return EthU.toRpcSig(sig.v, sig.r, sig.s)
}

export const isNotEmpty = (value: string) => value.replace(/\s+/g, '') !== ''
