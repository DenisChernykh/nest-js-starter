import type { RedisAuthConnectionManager } from '@/platform/redis/redis-auth.connection'
import { RedisReadinessIndicator } from '@/platform/redis/redis-readiness.indicator'

describe('RedisReadinessIndicator', () => {
  it('uses the auth command executor for a bounded PING', async () => {
    const execute = jest.fn(() => Promise.resolve('PONG'))
    const connection = {
      commandExecutor: { execute },
    } as unknown as RedisAuthConnectionManager
    const indicator = new RedisReadinessIndicator(connection, 25)
    expect(indicator.name).toBe('redis-auth')
    await expect(indicator.check(new AbortController().signal)).resolves.toBe(
      'up',
    )
    expect(execute).toHaveBeenCalledWith(
      'readiness-ping',
      expect.any(Function),
      expect.any(AbortSignal),
    )
  })
})
