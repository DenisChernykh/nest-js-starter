import type { RedisCoordinationConnectionManager } from '@/platform/redis/redis-coordination.connection'
import { RedisReadinessIndicator } from '@/platform/redis/redis-readiness.indicator'

describe('RedisReadinessIndicator', () => {
  it('uses the coordination command executor for a bounded PING', async () => {
    const execute = jest.fn(() => Promise.resolve('PONG'))
    const connection = {
      commandExecutor: { execute },
    } as unknown as RedisCoordinationConnectionManager
    const indicator = new RedisReadinessIndicator(connection, 25)
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
