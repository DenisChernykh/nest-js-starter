import { RuntimeConfigurationError } from '@/platform/config/runtime-config.types'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { requireQueueRuntimeConfig } from '@/platform/queue/queue-runtime-config'

const databaseUrl =
  'postgresql://starter:local-password@localhost:5432/starter?schema=public'

const secret = (byte: number): string =>
  Buffer.alloc(32, byte).toString('base64url')

function createConfig(queueUrl?: string) {
  return buildApiRuntimeConfig({
    DATABASE_URL: databaseUrl,
    REDIS_AUTH_URL: 'redis://default:auth-secret@127.0.0.1:6379',
    ...(queueUrl === undefined ? {} : { REDIS_QUEUE_URL: queueUrl }),
    AUTH_SESSION_KEY_SECRET: secret(1),
    AUTH_CSRF_SECRET: secret(2),
    AUTH_RATE_LIMIT_KEY_SECRET: secret(3),
    AUTH_NETWORK_METADATA_SECRET: secret(4),
  })
}

describe('requireQueueRuntimeConfig', () => {
  it('requires the optional queue URL only at queue composition time', () => {
    let thrown: unknown

    try {
      requireQueueRuntimeConfig(createConfig())
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(RuntimeConfigurationError)
    expect(thrown).toMatchObject({
      issues: [{ path: 'REDIS_QUEUE_URL', rule: 'any.required' }],
    })
    expect((thrown as Error).message).not.toContain('auth-secret')
  })

  it('returns frozen queue settings with independent queue deadlines', () => {
    const result = requireQueueRuntimeConfig(
      createConfig('redis://queue-user:queue-secret@queue.internal:6380'),
    )

    expect(result).toEqual({
      redisUrl: 'redis://queue-user:queue-secret@queue.internal:6380',
      connectTimeoutMs: 2_000,
      healthTimeoutMs: 2_500,
      shutdownGraceMs: 10_000,
    })
    expect(Object.isFrozen(result)).toBe(true)
  })
})
