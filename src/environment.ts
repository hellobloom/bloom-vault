import {toBoolean} from './utils'

export enum PipelineStages {
  development = 'development',
  staging = 'staging',
  production = 'production',
}

type OptionalIfTrue<B extends boolean, T> = B extends false ? T : T | undefined

function environmentVariable<T extends boolean = false>(name: string, optional?: T) {
  const value = process.env[name]

  if (
    (value === undefined || value === '') &&
    (optional === false || optional === undefined)
  ) {
    throw new Error(`Expected environment variable ${name}`)
  }
  return value as OptionalIfTrue<T, string>
}

const getPipelineStage = (): PipelineStages => {
  const stage = environmentVariable('PIPELINE_STAGE')

  if (stage in PipelineStages) {
    return PipelineStages[stage]
  }

  const stagesStr = JSON.stringify(Object.keys(PipelineStages))
  throw Error(`Please define PIPELINE_STAGE as one of: ${stagesStr}.`)
}

function getTokenExpiration() {
  const variable = 'TOKEN_EXPIRATION_SECONDS'
  const value = Number(environmentVariable(variable))
  if (isNaN(value)) throw new Error(`invalid ${variable}`)
  if (value <= 0) throw new Error(`${variable} must be > 0`)
  return value
}

export const env = {
  nodeEnv: () => environmentVariable('NODE_ENV'),
  pipelineStage: () => getPipelineStage(),
  trustProxy: () => toBoolean(environmentVariable('TRUST_PROXY')),
  tokenExpirationSeconds: () => getTokenExpiration(),
  logUrl: () => environmentVariable('LOG_URL', true),
  logUser: () => environmentVariable('LOG_USER', true),
  logPassword: () => environmentVariable('LOG_PASSWORD', true),
  disableRateLimiting: () =>
    toBoolean(environmentVariable('DISABLE_RATE_LIMITING', true)),
  allowAnonymous: () => toBoolean(environmentVariable('ALLOW_ANONYMOUS')),
}
