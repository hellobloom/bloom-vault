export enum PipelineStages {
  development = 'development',
  staging = 'staging',
  production = 'production',
}

function environmentVariable(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Expected environment variable ${name}`)
  }
  return value
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
  nodeEnv: environmentVariable('NODE_ENV'),
  pipelineStage: getPipelineStage(),
  trustProxy: Boolean(environmentVariable('TRUST_PROXY')),
  tokenExpirationSeconds: getTokenExpiration(),
}
