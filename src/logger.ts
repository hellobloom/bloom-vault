import {env} from './environment'
import fetch from 'node-fetch'
import {attempt} from './utils'

export async function persistError(message: string, stack: string) {
  try {
    if (env.logUrl()) {
      await attempt(() => sendLog(message, stack), 3, 30000)
    }
    console.error(message, stack)
  } catch (error) {
    console.log(error)
    process.exit(1)
  }
}

const sendLog = async (message: string, stack: string) => {
  const payload = {
    $app: 'vault',
    $type: 'event',
    $body: JSON.stringify({message, stack, pipelineStage: env.pipelineStage()}),
  }
  await fetch(env.logUrl()!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(
        `${env.logUser()}:${env.logPassword()}`
      ).toString('base64')}`,
    },
    body: JSON.stringify(payload),
  })
}
