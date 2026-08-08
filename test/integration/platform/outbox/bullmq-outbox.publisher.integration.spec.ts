import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Test, type TestingModule } from '@nestjs/testing'
import { type Queue, Worker } from 'bullmq'
import type { StartedRedisContainer } from '@testcontainers/redis'

import { BullMqOutboxPublisher } from '@/platform/outbox/bullmq-outbox.publisher'
import type { OutboxMessageEnvelope } from '@/platform/outbox/outbox.contracts'
import { buildQueueWorkerRuntimeConfig } from '@/platform/config/runtime-environment'
import { BullmqConnectionModule } from '@/platform/queue/bullmq-connection.module'
import { createBullmqWorkerOptions } from '@/platform/queue/bullmq-redis-options'
import { startRedisContainer } from '@test/integration/support/redis-container'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

const queueName = 'outbox-publisher-test'

const message: OutboxMessageEnvelope = {
  messageId: '550e8400-e29b-41d4-a716-446655440000',
  destination: 'notifications',
  type: 'inquiry.submitted',
  version: 1,
  occurredAt: '2026-08-08T00:00:00.000Z',
  payload: { inquiryId: 'inquiry-123' },
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
    const queue = application.get<Queue<OutboxMessageEnvelope>>(
      getQueueToken(queueName),
    )
    const publisher = new BullMqOutboxPublisher(queue)

    await publisher.publish(message, { redrivePublished: false })
    await publisher.publish(message, { redrivePublished: false })

    await expect(queue.getJob(message.messageId)).resolves.toMatchObject({
      id: message.messageId,
      name: message.type,
      data: message,
    })
    await expect(queue.count()).resolves.toBe(1)

    let deliveries = 0
    const worker = new Worker<OutboxMessageEnvelope>(
      queueName,
      () => {
        deliveries += 1
        return Promise.resolve()
      },
      { connection: createBullmqWorkerOptions(config) },
    )
    try {
      await waitForCondition(async () => {
        const job = await queue.getJob(message.messageId)
        return (await job?.getState()) === 'completed' && deliveries === 1
      }, 5_000)

      await publisher.publish(message, { redrivePublished: true })

      await waitForCondition(async () => {
        const job = await queue.getJob(message.messageId)
        return (await job?.getState()) === 'completed' && deliveries === 2
      }, 5_000)
      await expect(queue.getJob(message.messageId)).resolves.toMatchObject({
        id: message.messageId,
      })
    } finally {
      await worker.close()
    }
  })
})
