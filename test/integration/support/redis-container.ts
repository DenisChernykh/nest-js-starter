import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis'
import { createClient } from 'redis'

import { REDIS_IMAGE } from './redis-image'

const redisTestPassword = 'nest_js_starter_test'

/** Starts one isolated password-protected Redis without container reuse. */
export async function startRedisContainer(): Promise<StartedRedisContainer> {
  const container = await new RedisContainer(REDIS_IMAGE)
    .withPassword(redisTestPassword)
    .start()
  const client = createClient({
    url: container.getConnectionUrl(),
    disableOfflineQueue: true,
    commandOptions: { timeout: 5_000 },
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: false,
    },
  })
  client.on('error', () => undefined)
  try {
    await client.connect()
    const reply = await client.ping()
    if (reply !== 'PONG') {
      throw new Error('Redis readiness check returned an unexpected response')
    }
    return container
  } catch (error: unknown) {
    await container.stop()
    throw error
  } finally {
    client.destroy()
  }
}

/** Returns a log-safe projection of a test container connection URL. */
export function getRedactedRedisConnectionUrl(
  container: StartedRedisContainer,
): string {
  const url = new URL(container.getConnectionUrl())
  if (url.password !== '') url.password = '[redacted]'
  return url.toString()
}
