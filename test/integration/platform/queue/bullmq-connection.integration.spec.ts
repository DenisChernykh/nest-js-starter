import { Module } from '@nestjs/common'
import {
  BullModule,
  Processor,
  WorkerHost,
  getQueueToken,
} from '@nestjs/bullmq'
import { Test, type TestingModule } from '@nestjs/testing'
import type { Job, Queue } from 'bullmq'
import type { StartedRedisContainer } from '@testcontainers/redis'

import { runWorkerApplication } from '@/bootstrap/workers/run-worker-application'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { BullmqConnectionModule } from '@/platform/queue/bullmq-connection.module'
import { requireQueueRuntimeConfig } from '@/platform/queue/queue-runtime-config'
import { requiredRuntimeEnvironment } from '@test/support/required-runtime-environment'
import { startRedisContainer } from '@test/integration/support/redis-container'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

const queueName = 'test-only-queue'

interface TestPayload {
  readonly logicalPayloadId: string
}

const delivered: Array<{
  readonly jobId: string
  readonly logicalPayloadId: string
}> = []

@Processor(queueName)
class TestOnlyProcessor extends WorkerHost {
  public process(job: Job<TestPayload>): Promise<void> {
    delivered.push({
      jobId: String(job.id),
      logicalPayloadId: job.data.logicalPayloadId,
    })
    return Promise.resolve()
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: queueName })],
})
class TestOnlyProducerModule {}

@Module({
  imports: [BullModule.registerQueue({ name: queueName })],
  providers: [TestOnlyProcessor],
})
class TestOnlyWorkerModule {}

async function closeWithDeadline(context: TestingModule): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      context.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Test application close exceeded deadline')),
          5_000,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

describe('BullMQ connection foundation', () => {
  it('delivers distinct BullMQ jobs with one logical payload through real Redis', async () => {
    const container: StartedRedisContainer = await startRedisContainer()
    delivered.length = 0
    let producerContext: TestingModule | undefined
    let workerContext: TestingModule | undefined
    let workerRun: Promise<void> | undefined

    try {
      const queueConfig = requireQueueRuntimeConfig(
        buildApiRuntimeConfig(
          requiredRuntimeEnvironment({
            DATABASE_URL:
              'postgresql://starter:test@127.0.0.1:5432/starter?schema=public',
            REDIS_QUEUE_URL: container.getConnectionUrl(),
          }),
        ),
      )
      workerContext = await Test.createTestingModule({
        imports: [
          BullmqConnectionModule.forWorker(queueConfig),
          TestOnlyWorkerModule,
        ],
      }).compile()
      await workerContext.init()
      workerRun = runWorkerApplication({
        application: workerContext,
        shutdownGraceMs: queueConfig.shutdownGraceMs,
        onStarted: () => undefined,
        waitForTermination: async (close) => {
          await waitForCondition(
            () => Promise.resolve(delivered.length === 2),
            10_000,
          )
          await close()
        },
      })

      producerContext = await Test.createTestingModule({
        imports: [
          BullmqConnectionModule.forProducer(queueConfig),
          TestOnlyProducerModule,
        ],
      }).compile()
      await producerContext.init()
      const queue = producerContext.get<Queue<TestPayload>>(
        getQueueToken(queueName),
      )

      await queue.add(
        'test-job',
        { logicalPayloadId: 'same-payload' },
        { jobId: 'delivery-one' },
      )
      await queue.add(
        'test-job',
        { logicalPayloadId: 'same-payload' },
        { jobId: 'delivery-two' },
      )

      await workerRun
      expect(delivered).toEqual([
        { jobId: 'delivery-one', logicalPayloadId: 'same-payload' },
        { jobId: 'delivery-two', logicalPayloadId: 'same-payload' },
      ])
    } finally {
      try {
        await Promise.all([
          workerRun ?? Promise.resolve(),
          producerContext === undefined
            ? Promise.resolve()
            : closeWithDeadline(producerContext),
          workerContext === undefined || workerRun !== undefined
            ? Promise.resolve()
            : closeWithDeadline(workerContext),
        ])
      } finally {
        await container.stop()
      }
    }
  })
})
