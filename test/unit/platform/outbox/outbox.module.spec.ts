import { BullModule, getQueueToken } from '@nestjs/bullmq'
import {
  type BullMqOutboxRelayOptions,
  OutboxRelayModule,
} from '@/platform/outbox/outbox-relay.module'
import { OutboxRelayRuntimeModule } from '@/platform/outbox/outbox-relay-runtime.module'
import { buildOutboxRelayRuntimeConfig } from '@/platform/config/runtime-environment'
import { OutboxModule } from '@/platform/outbox/outbox.module'
import { TransactionalOutboxWriter } from '@/platform/outbox/transactional-outbox.writer'

describe('outbox Nest composition', () => {
  it('keeps the writer opt-in and exports only the writer boundary', () => {
    const module = OutboxModule.forWriter()

    expect(module.module).toBe(OutboxModule)
    expect(module.exports).toEqual([TransactionalOutboxWriter])
  })

  it('binds one consumer-owned BullMQ queue for one logical destination', () => {
    const module = OutboxRelayModule.forBullMq({
      destination: 'notifications',
      queueName: 'notification-delivery',
    })

    expect(module.module).toBe(OutboxRelayModule)
    expect(module.imports).toHaveLength(2)
    expect(module.providers).toContainEqual(
      expect.objectContaining({
        inject: [getQueueToken('notification-delivery')],
      }),
    )
  })

  it('does not allow queue policy to replace platform connection topology', () => {
    const registerQueue = jest.spyOn(BullModule, 'registerQueue')
    const queueOptions = {
      defaultJobOptions: { attempts: 3 },
      connection: { host: 'unowned-redis' },
      processors: ['unowned-processor'],
      configKey: 'unowned-root',
      forceDisconnectOnShutdown: true,
    } as unknown as NonNullable<BullMqOutboxRelayOptions['queueOptions']>

    try {
      OutboxRelayModule.forBullMq({
        destination: 'notifications',
        queueName: 'notification-delivery',
        queueOptions,
      })

      expect(registerQueue).toHaveBeenCalledWith({
        name: 'notification-delivery',
        defaultJobOptions: { attempts: 3 },
      })
    } finally {
      registerQueue.mockRestore()
    }
  })

  it('creates a bounded process-instance owner for every standalone relay', () => {
    const composeRelay = jest.spyOn(OutboxRelayModule, 'forBullMq')
    const config = buildOutboxRelayRuntimeConfig({
      DATABASE_URL: 'postgresql://app:secret@postgres:5432/app',
      REDIS_QUEUE_URL: 'redis://queue:secret@redis:6379',
      OTEL_SERVICE_NAME: 's'.repeat(63),
      SERVICE_REVISION: 'r'.repeat(128),
    })

    try {
      OutboxRelayRuntimeModule.forBullMq({
        config,
        destination: 'notifications',
        queueName: 'notification-delivery',
      })
      OutboxRelayRuntimeModule.forBullMq({
        config,
        destination: 'notifications',
        queueName: 'notification-delivery',
      })

      const firstOwner = composeRelay.mock.calls[0]?.[0].ownerId
      const secondOwner = composeRelay.mock.calls[1]?.[0].ownerId
      expect(firstOwner).toHaveLength(160)
      expect(secondOwner).toHaveLength(160)
      expect(firstOwner).not.toBe(secondOwner)
    } finally {
      composeRelay.mockRestore()
    }
  })
})
