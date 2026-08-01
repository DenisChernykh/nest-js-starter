import type { DynamicModule } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'

import { BullmqConnectionModule } from '@/platform/queue/bullmq-connection.module'
import type { QueueRuntimeConfig } from '@/platform/queue/queue-runtime-config'

const config: QueueRuntimeConfig = {
  redisUrl: 'redis://queue.internal:6379',
  connectTimeoutMs: 2_000,
  healthTimeoutMs: 2_500,
  shutdownGraceMs: 10_000,
}

function expectSingleBullRootModule(dynamicModule: DynamicModule): void {
  const imports: readonly unknown[] = dynamicModule.imports ?? []
  expect(imports).toHaveLength(1)
  const rootImport = imports[0]
  if (
    typeof rootImport !== 'object' ||
    rootImport === null ||
    !('module' in rootImport) ||
    !('providers' in rootImport)
  ) {
    throw new Error('Expected one BullMQ root dynamic module')
  }
  expect(rootImport.module).toBe(BullModule)
  expect(Array.isArray(rootImport.providers)).toBe(true)
}

describe('BullmqConnectionModule', () => {
  it('wraps exactly one root producer connection without queue registration', () => {
    const dynamicModule = BullmqConnectionModule.forProducer(config)

    expect(dynamicModule.module).toBe(BullmqConnectionModule)
    expectSingleBullRootModule(dynamicModule)
    expect(dynamicModule.providers ?? []).toHaveLength(0)
  })

  it('wraps exactly one root worker connection without queue registration', () => {
    const dynamicModule = BullmqConnectionModule.forWorker(config)

    expect(dynamicModule.module).toBe(BullmqConnectionModule)
    expectSingleBullRootModule(dynamicModule)
    expect(dynamicModule.providers ?? []).toHaveLength(0)
  })
})
