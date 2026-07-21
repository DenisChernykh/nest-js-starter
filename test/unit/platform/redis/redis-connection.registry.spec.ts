import { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'
import type { RedisManagedClient } from '@/platform/redis/redis-capability'
import type { RedisClientFactory } from '@/platform/redis/redis-client.factory'
import { RedisConnectionRegistry } from '@/platform/redis/redis-connection.registry'

function managedClient(): RedisManagedClient {
  return {
    isOpen: false,
    isReady: false,
    connect: jest.fn(function (this: RedisManagedClient) {
      Object.assign(this, { isOpen: true, isReady: true })
      return Promise.resolve(undefined)
    }),
    ping: jest.fn(() => Promise.resolve('PONG')),
    sendCommand: <T>() => Promise.resolve(undefined as T),
    close: jest.fn(() => Promise.resolve(undefined)),
    destroy: jest.fn(),
    duplicate: jest.fn(),
    onError: jest.fn(),
  }
}

describe('RedisConnectionRegistry', () => {
  it('connects required coordination eagerly and cache only on first use', async () => {
    const coordination = managedClient()
    const cache = managedClient()
    const factory = {
      create: jest
        .fn()
        .mockReturnValueOnce(coordination)
        .mockReturnValueOnce(cache),
    } as unknown as RedisClientFactory
    const registry = new RedisConnectionRegistry(
      factory,
      new ActiveOperationTracker(),
      {
        coordinationUrl: 'redis://coordination:6379',
        cacheUrl: 'redis://cache:6379',
        commandTimeoutMs: 50,
      },
    )
    registry.register('coordination', true)
    registry.register('cache', false)
    registry.seal()

    await registry.connectRequired(new AbortController().signal)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const coordinationConnect = jest.mocked(coordination.connect)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const cacheConnect = jest.mocked(cache.connect)
    expect(coordinationConnect).toHaveBeenCalledTimes(1)
    expect(cacheConnect).not.toHaveBeenCalled()

    await registry.executor('cache').execute('ping', (client) => client.ping())
    expect(cacheConnect).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate and late registration', () => {
    const registry = new RedisConnectionRegistry(
      { create: jest.fn() } as unknown as RedisClientFactory,
      new ActiveOperationTracker(),
      {
        coordinationUrl: 'redis://coordination:6379',
        commandTimeoutMs: 50,
      },
    )
    registry.register('coordination', true)
    expect(() => registry.register('coordination', true)).toThrow()
    registry.seal()
    expect(() => registry.register('cache', false)).toThrow()
  })

  it('creates pubsub only as a dedicated duplicate of a registered client', () => {
    const coordination = managedClient()
    const subscriber = managedClient()
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const duplicate = jest.mocked(coordination.duplicate)
    duplicate.mockReturnValue(subscriber)
    const factory = {
      create: jest.fn(() => coordination),
    } as unknown as RedisClientFactory
    const registry = new RedisConnectionRegistry(
      factory,
      new ActiveOperationTracker(),
      {
        coordinationUrl: 'redis://coordination:6379',
        commandTimeoutMs: 50,
      },
    )
    registry.register('coordination', true)
    registry.registerSubscriber('coordination')
    registry.seal()

    expect(registry.client('pubsub')).toBe(subscriber)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const create = jest.mocked(factory.create)
    expect(duplicate).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('never reconnects a capability after lifecycle close begins', async () => {
    const coordination = managedClient()
    const registry = new RedisConnectionRegistry(
      {
        create: jest.fn(() => coordination),
      } as unknown as RedisClientFactory,
      new ActiveOperationTracker(),
      {
        coordinationUrl: 'redis://coordination:6379',
        commandTimeoutMs: 50,
      },
    )
    registry.register('coordination', true)
    registry.seal()

    await registry.closeAll(new AbortController().signal)
    await expect(
      registry
        .executor('coordination')
        .execute('ping-after-close', (client) => client.ping()),
    ).rejects.toThrow('Redis connection admission is closed')
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(coordination.connect).not.toHaveBeenCalled()
  })
})
