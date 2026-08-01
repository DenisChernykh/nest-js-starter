import { BullModule } from '@nestjs/bullmq'

import { BullmqConnectionModule } from '@/platform/queue/bullmq-connection.module'
import type { QueueRuntimeConfig } from '@/platform/queue/queue-runtime-config'

const config: QueueRuntimeConfig = {
  redisUrl: 'redis://queue.internal:6379',
  connectTimeoutMs: 2_000,
  healthTimeoutMs: 2_500,
  shutdownGraceMs: 10_000,
}

describe('BullmqConnectionModule', () => {
  it('wraps exactly one root producer connection without queue registration', () => {
    const dynamicModule = BullmqConnectionModule.forProducer(config)

    expect(dynamicModule.module).toBe(BullmqConnectionModule)
    expect(dynamicModule.imports).toHaveLength(1)
    expect(dynamicModule.imports?.[0]).toEqual(
      expect.objectContaining({
        module: BullModule,
        providers: expect.any(Array),
      }),
    )
    expect(dynamicModule.providers ?? []).toHaveLength(0)
  })

  it('wraps exactly one root worker connection without queue registration', () => {
    const dynamicModule = BullmqConnectionModule.forWorker(config)

    expect(dynamicModule.module).toBe(BullmqConnectionModule)
    expect(dynamicModule.imports).toHaveLength(1)
    expect(dynamicModule.imports?.[0]).toEqual(
      expect.objectContaining({
        module: BullModule,
        providers: expect.any(Array),
      }),
    )
    expect(dynamicModule.providers ?? []).toHaveLength(0)
  })
})
