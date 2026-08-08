import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { OutboxRelayModule } from '@/platform/outbox/outbox-relay.module'
import { OutboxModule } from '@/platform/outbox/outbox.module'
import { TransactionalOutboxWriter } from '@/platform/outbox/transactional-outbox.writer'

describe('outbox Nest composition', () => {
  it('keeps the writer opt-in and exports only the writer boundary', () => {
    const module = OutboxModule.forWriter()

    expect(module.module).toBe(OutboxModule)
    expect(module.exports).toContain(TransactionalOutboxWriter)
  })

  it('binds one consumer-owned BullMQ queue for one logical destination', () => {
    const module = OutboxRelayModule.forBullMq({
      destination: 'notifications',
      queueName: 'notification-delivery',
    })

    expect(module.module).toBe(OutboxRelayModule)
    expect(module.imports).toContainEqual(
      expect.objectContaining({ module: BullModule }),
    )
    expect(module.providers).toContainEqual(
      expect.objectContaining({
        inject: [getQueueToken('notification-delivery')],
      }),
    )
  })
})
