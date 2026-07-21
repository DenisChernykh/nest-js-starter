import type { StartedRedisContainer } from '@testcontainers/redis'

import { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'
import { RedisCacheClient } from '@/platform/redis/redis-cache.client'
import { RedisCacheEvents } from '@/platform/redis/redis-cache.events'
import { RedisClientFactory } from '@/platform/redis/redis-client.factory'
import { RedisConnectionRegistry } from '@/platform/redis/redis-connection.registry'
import { RedisLifecycle } from '@/platform/redis/redis-lifecycle'
import type { TransactionPort } from '@/shared/application/transaction.port'
import type { CatalogItem } from '@test/fixtures/cache-module/application/catalog-cache.port'
import {
  CatalogQuery,
  CatalogWriteService,
} from '@test/fixtures/cache-module/application/catalog-query'
import { RedisCatalogCacheAdapter } from '@test/fixtures/cache-module/infrastructure/redis-catalog-cache.adapter'
import { startRedisContainer } from '@test/integration/support/redis-container'

describe('fixture cache module contract', () => {
  let container: StartedRedisContainer
  let lifecycle: RedisLifecycle
  let cache: RedisCatalogCacheAdapter

  beforeAll(async () => {
    container = await startRedisContainer()
    const registry = new RedisConnectionRegistry(
      new RedisClientFactory({
        connectTimeoutMs: 1_000,
        commandTimeoutMs: 1_000,
      }),
      new ActiveOperationTracker(),
      {
        coordinationUrl: container.getConnectionUrl(),
        cacheUrl: container.getConnectionUrl(),
        commandTimeoutMs: 1_000,
      },
    )
    registry.register('coordination', true)
    registry.register('cache', false)
    registry.seal()
    lifecycle = new RedisLifecycle(registry, 1_000)
    await lifecycle.connect(AbortSignal.timeout(2_000))
    cache = new RedisCatalogCacheAdapter(
      new RedisCacheClient(
        registry.executor('cache'),
        new RedisCacheEvents(),
        () => 0,
      ),
      'fixture',
    )
  })

  afterAll(async () => {
    await lifecycle.close(AbortSignal.timeout(1_000))
    await container.stop()
  })

  it('reads through cache and validates its immutable payload', async () => {
    const load = jest.fn(() =>
      Promise.resolve<CatalogItem>({ id: 'one', title: 'First' }),
    )
    const query = new CatalogQuery(cache, load)

    await expect(query.execute('one')).resolves.toEqual({
      id: 'one',
      title: 'First',
    })
    await expect(query.execute('one')).resolves.toEqual({
      id: 'one',
      title: 'First',
    })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('invalidates only after commit and never after rollback', async () => {
    let current: CatalogItem = { id: 'two', title: 'Before' }
    const query = new CatalogQuery(cache, () => Promise.resolve(current))
    await query.execute('two')

    const rollback: TransactionPort = {
      run: async (operation) => {
        await operation()
        throw new Error('rollback')
      },
    }
    const rolledBackWrite = new CatalogWriteService(rollback, cache, () =>
      Promise.resolve(undefined),
    )
    await expect(
      rolledBackWrite.update({ id: 'two', title: 'Not committed' }),
    ).rejects.toThrow('rollback')
    current = { id: 'two', title: 'Changed outside transaction' }
    await expect(query.execute('two')).resolves.toEqual({
      id: 'two',
      title: 'Before',
    })

    const commit: TransactionPort = {
      run: (operation) => operation(),
    }
    const committedWrite = new CatalogWriteService(commit, cache, (item) => {
      current = item
      return Promise.resolve(undefined)
    })
    await committedWrite.update({ id: 'two', title: 'After' })

    await expect(query.execute('two')).resolves.toEqual({
      id: 'two',
      title: 'After',
    })
  })
})
