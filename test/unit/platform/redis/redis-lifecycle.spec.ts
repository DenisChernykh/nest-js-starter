import type { RedisConnectionRegistry } from '@/platform/redis/redis-connection.registry'
import {
  REDIS_SHUTDOWN_ORDER,
  RedisLifecycle,
} from '@/platform/redis/redis-lifecycle'

describe('RedisLifecycle', () => {
  it('shares startup and shutdown while preserving Redis shutdown order', async () => {
    const registry = {
      connectRequired: jest.fn(() => Promise.resolve(undefined)),
      closeAll: jest.fn(() => Promise.resolve(undefined)),
    } as unknown as RedisConnectionRegistry
    const lifecycle = new RedisLifecycle(registry, 50)
    const signal = new AbortController().signal

    await Promise.all([lifecycle.connect(signal), lifecycle.connect(signal)])
    await Promise.all([lifecycle.close(signal), lifecycle.close(signal)])

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const connectRequired = jest.mocked(registry.connectRequired)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const closeAll = jest.mocked(registry.closeAll)
    expect(connectRequired).toHaveBeenCalledTimes(1)
    expect(closeAll).toHaveBeenCalledTimes(1)
    expect(lifecycle.name).toBe('redis')
    expect(lifecycle.order).toBe(REDIS_SHUTDOWN_ORDER)
    expect(REDIS_SHUTDOWN_ORDER).toBeLessThan(300)
  })
})
