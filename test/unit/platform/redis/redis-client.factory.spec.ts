import { RedisClientFactory } from '@/platform/redis/redis-client.factory'
import type { RedisManagedClient } from '@/platform/redis/redis-capability'

function managedClient(): RedisManagedClient {
  return {
    isOpen: false,
    isReady: false,
    connect: jest.fn(() => Promise.resolve(undefined)),
    ping: jest.fn(() => Promise.resolve('PONG')),
    sendCommand: <T>() => Promise.resolve(undefined as T),
    close: jest.fn(() => Promise.resolve(undefined)),
    destroy: jest.fn(),
    duplicate: jest.fn(),
    onError: jest.fn(),
  }
}

describe('RedisClientFactory', () => {
  it('creates a TLS ACL client with bounded queues and an error listener', () => {
    const client = managedClient()
    const createDriver = jest.fn(() => client)
    const factory = new RedisClientFactory(
      { connectTimeoutMs: 1_500, commandTimeoutMs: 900 },
      createDriver,
    )

    expect(
      factory.create('rediss://coordination-user:password@redis.internal:6380'),
    ).toBe(client)
    expect(createDriver).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'rediss://coordination-user:password@redis.internal:6380',
        disableOfflineQueue: true,
        commandsQueueMaxLength: 1_000,
        commandTimeoutMs: 900,
        connectTimeoutMs: 1_500,
        tls: true,
      }),
    )
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const onError = jest.mocked(client.onError)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
