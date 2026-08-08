import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Test, type TestingModule } from '@nestjs/testing'
import type { Queue } from 'bullmq'
import type { StartedRedisContainer } from '@testcontainers/redis'

import { BullMqOutboxPublisher } from '@/platform/outbox/bullmq-outbox.publisher'
import type { ClaimedOutboxMessage } from '@/platform/outbox/outbox.ports'
import { buildQueueWorkerRuntimeConfig } from '@/platform/config/runtime-environment'
import { BullmqConnectionModule } from '@/platform/queue/bullmq-connection.module'
import { startRedisContainer } from '@test/integration/support/redis-container'

const queueName = 'outbox-publisher-test'

const message: ClaimedOutboxMessage = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  destination: 'notifications',
  type: 'inquiry.submitted',
  version: 1,
  occurredAt: new Date('2026-08-08T00:00:00.000Z'),
  payload: { inquiryId: 'inquiry-123' },
  attemptCount: 0,
  claimToken: '550e8400-e29b-41d4-a716-446655440001',
}

describe('BullMqOutboxPublisher', () => {
  let redis: StartedRedisContainer | undefined
  let application: TestingModule | undefined

  afterAll(async () => {
    await application?.close()
    await redis?.stop()
  })

  it('publishes one canonical envelope under the stable outbox id', async () => {
    redis = await startRedisContainer()
    const config = buildQueueWorkerRuntimeConfig({
      REDIS_QUEUE_URL: redis.getConnectionUrl(),
    })
    application = await Test.createTestingModule({
      imports: [
        BullmqConnectionModule.forProducer(config),
        BullModule.registerQueue({ name: queueName }),
      ],
    }).compile()
    await application.init()
    const queue = application.get<Queue<ClaimedOutboxMessage>>(
      getQueueToken(queueName),
    )
    const publisher = new BullMqOutboxPublisher(queue)

    await publisher.publish(message)
    await publisher.publish(message)

    await expect(queue.getJob(message.id)).resolves.toMatchObject({
      id: message.id,
      name: message.type,
      data: { ...message, occurredAt: message.occurredAt.toISOString() },
    })
    await expect(queue.count()).resolves.toBe(1)
  })
})
