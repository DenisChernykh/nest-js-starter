import { Test, type TestingModule } from '@nestjs/testing'
import type { StartedRedisContainer } from '@testcontainers/redis'

import { buildOutboxRelayRuntimeConfig } from '@/platform/config/runtime-environment'
import { OUTBOX_RELAY_RUNNER } from '@/platform/outbox/outbox-relay.module'
import { OutboxRelayRuntimeModule } from '@/platform/outbox/outbox-relay-runtime.module'
import { startRedisContainer } from '@test/integration/support/redis-container'

describe('OutboxRelayRuntimeModule', () => {
  let redis: StartedRedisContainer | undefined
  let application: TestingModule | undefined

  afterAll(async () => {
    await application?.close()
    await redis?.stop()
  })

  it('compiles from only PostgreSQL, queue Redis and service identity config', async () => {
    redis = await startRedisContainer()
    const config = buildOutboxRelayRuntimeConfig({
      DATABASE_URL: 'postgresql://app:secret@postgres:5432/app',
      REDIS_QUEUE_URL: redis.getConnectionUrl(),
    })

    application = await Test.createTestingModule({
      imports: [
        OutboxRelayRuntimeModule.forBullMq({
          config,
          destination: 'notifications',
          queueName: 'notification-delivery',
          queueOptions: {
            defaultJobOptions: {
              attempts: 3,
              removeOnComplete: { age: 86_400 },
              removeOnFail: { age: 604_800 },
            },
          },
        }),
      ],
    }).compile()
    await application.init()

    expect(application.get(OUTBOX_RELAY_RUNNER)).toBeDefined()
  })
})
