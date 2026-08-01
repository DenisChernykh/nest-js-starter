import type { RedisAuthConnectionManager } from '@/platform/redis/redis-auth.connection'
import { RedisLifecycle } from '@/platform/redis/redis-lifecycle'

/* eslint-disable @typescript-eslint/unbound-method */

describe('RedisLifecycle', () => {
  it('shares startup and shutdown on the auth manager', async () => {
    const connection = {
      connect: jest.fn(() => Promise.resolve()),
      close: jest.fn(() => Promise.resolve()),
    } as unknown as RedisAuthConnectionManager
    const lifecycle = new RedisLifecycle(connection, 50)
    const signal = new AbortController().signal
    await Promise.all([lifecycle.connect(signal), lifecycle.connect(signal)])
    await Promise.all([lifecycle.close(signal), lifecycle.close(signal)])
    expect(connection.connect).toHaveBeenCalledTimes(1)
    expect(connection.close).toHaveBeenCalledTimes(1)
  })
})
