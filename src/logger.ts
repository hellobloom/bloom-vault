import {env} from './environment'
import fetch from 'node-fetch'

export async function persistError(message: string, stack: string) {
  try {
    if (env.logUrl) {
      await attempt(() => sendLog(message, stack), 3, 30000)
    }
    console.error(message, stack)
  } catch (error) {
    console.log(error)
    process.exit(1)
  }
}

const sendLog = async (message: string, stack: string) => {
  let payload = {
    $app: 'vault',
    $type: 'event',
    $body: JSON.stringify({message, stack}),
  }
  await fetch(env.logUrl!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(
        `${env.logUser}:${env.logPassword}`
      ).toString('base64')}`,
    },
    body: JSON.stringify(payload),
  })
}

const sleep = (miliseconds: number) =>
  new Promise(resolve => setTimeout(resolve, miliseconds))

// this can be used as a sort of async worker that lives within the same process
async function attempt<T>(
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
