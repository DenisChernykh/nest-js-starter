import type { RedisManagedClient } from '@/platform/redis/redis-capability'
import { RedisCacheClient } from '@/platform/redis/redis-cache.client'
import { RedisCacheEvents } from '@/platform/redis/redis-cache.events'
import { createJsonRedisCodec } from '@/platform/redis/redis-codec'
import type { RedisConnectionRegistry } from '@/platform/redis/redis-connection.registry'

interface CachedItem {
  readonly id: string
}

const itemCodec = createJsonRedisCodec<CachedItem>(
  (value): value is CachedItem =>
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string',
)

function createHarness(initial: unknown = null): {
  readonly cache: RedisCacheClient
  readonly sendCommand: jest.Mock<Promise<unknown>, [readonly string[]]>
  readonly eventTypes: string[]
} {
  const sendCommand = jest.fn<Promise<unknown>, [readonly string[]]>(() =>
    Promise.resolve(initial),
  )
  const registry = {
    executor: () => ({
      execute: <T>(
        _name: string,
        operation: (client: RedisManagedClient) => Promise<T>,
      ) => operation({ sendCommand } as unknown as RedisManagedClient),
    }),
  } as unknown as RedisConnectionRegistry
  const events = new RedisCacheEvents()
  const eventTypes: string[] = []
  events.subscribe((event) => eventTypes.push(event.type))
  return {
    cache: new RedisCacheClient(registry.executor('cache'), events, () => 0.5),
    sendCommand,
    eventTypes,
  }
}

describe('RedisCacheClient', () => {
  it('decodes a hit and emits a typed hit event', async () => {
    const harness = createHarness('{"id":"42"}')

    await expect(
      harness.cache.get('starter:v1:item:42', itemCodec),
    ).resolves.toEqual({ id: '42' })
    expect(harness.eventTypes).toEqual(['hit'])
  })

  it('deletes an invalid payload and reports invalid followed by miss', async () => {
    const harness = createHarness('{"unexpected":true}')

    await expect(
      harness.cache.get('starter:v1:item:42', itemCodec),
    ).resolves.toBeUndefined()
    expect(harness.sendCommand).toHaveBeenNthCalledWith(2, [
      'DEL',
      'starter:v1:item:42',
    ])
    expect(harness.eventTypes).toEqual(['invalid', 'miss'])
  })

  it('writes with a bounded, deterministically jittered PX TTL', async () => {
    const harness = createHarness('OK')

    await harness.cache.set(
      'starter:v1:item:42',
      { id: '42' },
      { codec: itemCodec, ttlMs: 10_000, jitterRatio: 0.2 },
    )

    expect(harness.sendCommand).toHaveBeenCalledWith([
      'SET',
      'starter:v1:item:42',
      '{"id":"42"}',
      'PX',
      '9000',
    ])
    expect(harness.eventTypes).toEqual(['write'])
  })

  it.each([
    { ttlMs: 0, jitterRatio: 0 },
    { ttlMs: 31 * 24 * 60 * 60 * 1_000, jitterRatio: 0 },
    { ttlMs: 1_000, jitterRatio: -0.01 },
    { ttlMs: 1_000, jitterRatio: 0.26 },
  ])('rejects an invalid finite cache policy %j', async (policy) => {
    const harness = createHarness('OK')

    await expect(
      harness.cache.set(
        'starter:v1:item:42',
        { id: '42' },
        {
          codec: itemCodec,
          ...policy,
        },
      ),
    ).rejects.toThrow()
    expect(harness.sendCommand).not.toHaveBeenCalled()
  })

  it('bypasses a network failure and emits error', async () => {
    const harness = createHarness()
    harness.sendCommand.mockRejectedValueOnce(new Error('network unavailable'))

    await expect(
      harness.cache.get('starter:v1:item:42', itemCodec),
    ).resolves.toBeUndefined()
    expect(harness.eventTypes).toEqual(['error'])
  })

  it('invalidates only the exact requested key', async () => {
    const harness = createHarness(1)

    await harness.cache.invalidate('starter:v1:item:42')

    expect(harness.sendCommand).toHaveBeenCalledWith([
      'DEL',
      'starter:v1:item:42',
    ])
    expect(harness.eventTypes).toEqual(['invalidate'])
  })
})
