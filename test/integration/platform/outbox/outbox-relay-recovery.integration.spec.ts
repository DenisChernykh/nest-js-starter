import { BullModule, getQueueToken } from '@nestjs/bullmq'
import { Test, type TestingModule } from '@nestjs/testing'
import type { Queue } from 'bullmq'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedRedisContainer } from '@testcontainers/redis'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import {
  buildApiRuntimeConfig,
  buildQueueWorkerRuntimeConfig,
} from '@/platform/config/runtime-environment'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import { BullMqOutboxPublisher } from '@/platform/outbox/bullmq-outbox.publisher'
import { PrismaOutboxStore } from '@/platform/outbox/prisma-outbox.store'
import { OutboxRelay } from '@/platform/outbox/outbox-relay'
import type { ClaimedOutboxMessage } from '@/platform/outbox/outbox.ports'
import { BullmqConnectionModule } from '@/platform/queue/bullmq-connection.module'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { startRedisContainer } from '@test/integration/support/redis-container'
import { runPrismaCommand } from '@test/integration/support/run-prisma-command'
import { requiredRuntimeEnvironment } from '@test/support/required-runtime-environment'

const queueName = 'outbox-recovery-test'
const messageId = '550e8400-e29b-41d4-a716-446655440099'

describe('transactional outbox relay recovery', () => {
  let postgres: StartedPostgreSqlContainer | undefined
  let redis: StartedRedisContainer | undefined
  let provider: PrismaClientProvider | undefined
  let application: TestingModule | undefined

  afterAll(async () => {
    await application?.close()
    await provider?.close(AbortSignal.timeout(2_000))
    await Promise.all([postgres?.stop(), redis?.stop()])
  })

  it('recovers a lease after Queue.add before PUBLISHED without losing the message', async () => {
    postgres = await startPostgresContainer()
    redis = await startRedisContainer()
    expect(
      runPrismaCommand(
        ['migrate', 'deploy', '--config', 'prisma.config.ts'],
        postgres.getConnectionUri(),
      ).exitCode,
    ).toBe(0)
    const runtimeConfig = new RuntimeConfigService(
      buildApiRuntimeConfig(
        requiredRuntimeEnvironment({
          DATABASE_URL: postgres.getConnectionUri(),
        }),
      ),
    )
    provider = new PrismaClientProvider(
      runtimeConfig,
      new PrismaTransactionContext(),
    )
    await provider.connect(AbortSignal.timeout(2_000))
    await provider.withClient((client) =>
      client.outboxMessage.create({
        data: {
          id: messageId,
          destination: 'notifications',
          type: 'inquiry.submitted',
          version: 1,
          occurredAt: new Date('2026-08-08T00:00:00.000Z'),
          nextAttemptAt: new Date(0),
          payload: { inquiryId: 'inquiry-123' },
        },
      }),
    )
    const queueConfig = buildQueueWorkerRuntimeConfig({
      REDIS_QUEUE_URL: redis.getConnectionUrl(),
    })
    application = await Test.createTestingModule({
      imports: [
        BullmqConnectionModule.forProducer(queueConfig),
        BullModule.registerQueue({ name: queueName }),
      ],
    }).compile()
    await application.init()
    const queue = application.get<Queue<ClaimedOutboxMessage>>(
      getQueueToken(queueName),
    )
    const store = new PrismaOutboxStore(
      provider,
      () => '550e8400-e29b-41d4-a716-446655440001',
    )
    const publisher = new BullMqOutboxPublisher(queue)
    const [crashedClaim] = await store.claim({
      destination: 'notifications',
      ownerId: 'relay-before-crash',
      leaseMs: 30_000,
      limit: 1,
    })
    if (crashedClaim === undefined)
      throw new Error('outbox message was not claimed')

    await publisher.publish(crashedClaim)
    await provider.withClient((client) =>
      client.outboxMessage.update({
        where: { id: messageId },
        data: { claimedUntil: new Date(0) },
      }),
    )
    const relay = new OutboxRelay(store, publisher, {
      destination: 'notifications',
      ownerId: 'relay-after-crash',
    })

    await relay.runOnce()

    await expect(
      provider.withClient((client) =>
        client.outboxMessage.findUniqueOrThrow({ where: { id: messageId } }),
      ),
    ).resolves.toMatchObject({ status: 'PUBLISHED' })
    await expect(queue.getJob(messageId)).resolves.toMatchObject({
      id: messageId,
      data: { id: messageId },
    })
  })
})
