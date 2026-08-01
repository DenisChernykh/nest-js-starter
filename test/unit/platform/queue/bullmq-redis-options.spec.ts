import {
  createBullmqProducerOptions,
  createBullmqWorkerOptions,
} from '@/platform/queue/bullmq-redis-options'
import type { QueueRuntimeConfig } from '@/platform/queue/queue-runtime-config'

const config: QueueRuntimeConfig = {
  redisUrl: 'redis://queue%40user:queue%3Asecret@queue.internal',
  connectTimeoutMs: 2_000,
  healthTimeoutMs: 2_500,
  shutdownGraceMs: 10_000,
}

describe('BullMQ Redis options', () => {
  it('maps a queue URL to bounded producer options without retaining the URL', () => {
    const options = createBullmqProducerOptions(config)

    expect(options).toEqual({
      host: 'queue.internal',
      port: 6_379,
      username: 'queue@user',
      password: 'queue:secret',
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
    })
    expect(JSON.stringify(options)).not.toContain(config.redisUrl)
  })

  it('maps a TLS queue URL to worker options with infinite command retries', () => {
    const options = createBullmqWorkerOptions({
      ...config,
      redisUrl: 'rediss://worker-user:worker%3Asecret@queue.internal:6380',
    })

    expect(options).toEqual({
      host: 'queue.internal',
      port: 6_380,
      username: 'worker-user',
      password: 'worker:secret',
      connectTimeout: 2_000,
      maxRetriesPerRequest: null,
      tls: {},
    })
  })

  it('normalizes bracketed IPv6 hostnames for ioredis', () => {
    const options = createBullmqProducerOptions({
      ...config,
      redisUrl: 'redis://queue-user:queue-secret@[::1]:6379',
    })

    expect(options.host).toBe('::1')
  })
})
