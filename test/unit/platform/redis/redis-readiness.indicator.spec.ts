import type { RedisManagedClient } from '@/platform/redis/redis-capability'
import type { RedisConnectionRegistry } from '@/platform/redis/redis-connection.registry'
import { RedisReadinessIndicator } from '@/platform/redis/redis-readiness.indicator'

describe('RedisReadinessIndicator', () => {
  it('returns down without PING when the coordination client is not ready', async () => {
    const execute = jest.fn()
    const registry = {
      client: () => ({ isReady: false }) as RedisManagedClient,
      executor: () => ({ execute }),
    } as unknown as RedisConnectionRegistry
    const indicator = new RedisReadinessIndicator(registry, 25)

    await expect(indicator.check(new AbortController().signal)).resolves.toBe(
      'down',
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires a successful bounded PING after isReady', async () => {
    const registry = {
      client: () => ({ isReady: true }) as RedisManagedClient,
      executor: () => ({
        execute: async (
          _name: string,
          operation: (client: RedisManagedClient) => Promise<string>,
        ) =>
          operation({
            ping: () => Promise.resolve('PONG'),
          } as RedisManagedClient),
      }),
    } as unknown as RedisConnectionRegistry
    const indicator = new RedisReadinessIndicator(registry, 25)

    await expect(indicator.check(new AbortController().signal)).resolves.toBe(
      'up',
    )
    expect(indicator).toEqual(
      expect.objectContaining({
        name: 'redis-coordination',
        required: true,
        timeoutMs: 25,
      }),
    )
  })
})
