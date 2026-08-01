import type {
  RedisClientFactory,
  RedisManagedClient,
} from '@/platform/redis/redis-client.factory'
import {
  RedisAuthConnectionManager,
  type RedisAuthConnectionConfig,
} from '@/platform/redis/redis-auth.connection'

function managedClient(): RedisManagedClient {
  return {
    isOpen: true,
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

describe('RedisAuthConnectionManager', () => {
  it('creates the node-redis client from the auth URL', async () => {
    const client = managedClient()
    const create = jest.fn(() => client)
    const config: RedisAuthConnectionConfig = {
      authUrl: 'redis://default:auth-secret@redis-auth:6379',
      connectTimeoutMs: 100,
      commandTimeoutMs: 100,
    }
    const manager = new RedisAuthConnectionManager(
      { create } as unknown as RedisClientFactory,
      config,
    )

    expect(create).toHaveBeenCalledWith(config.authUrl)
    await manager.connect(AbortSignal.timeout(100))
    await manager.close(AbortSignal.timeout(100))
  })
})
