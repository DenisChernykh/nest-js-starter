import { RuntimeConfigurationError } from '@/platform/config/runtime-config.types'
import { buildOutboxRelayRuntimeConfig } from '@/platform/config/runtime-environment'

describe('outbox relay runtime config', () => {
  it('requires only PostgreSQL, queue Redis and service identity settings', () => {
    const config = buildOutboxRelayRuntimeConfig({
      DATABASE_URL: 'postgresql://app:secret@postgres:5432/app',
      REDIS_QUEUE_URL: 'redis://queue:secret@redis:6379',
    })

    expect(config.database.url).toContain('postgres:5432')
    expect(config.queue.redisUrl).toContain('redis:6379')
    expect(config.logging.serviceName).toBe('nest-js-starter')
  })

  it('does not accept a missing queue Redis URL', () => {
    expect(() =>
      buildOutboxRelayRuntimeConfig({
        DATABASE_URL: 'postgresql://app:secret@postgres:5432/app',
      }),
    ).toThrow(RuntimeConfigurationError)
  })
})
