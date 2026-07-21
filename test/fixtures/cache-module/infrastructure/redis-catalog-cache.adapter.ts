import { RedisCacheClient } from '@/platform/redis/redis-cache.client'
import { createJsonRedisCodec } from '@/platform/redis/redis-codec'
import { RedisKeyBuilder } from '@/platform/redis/redis-key.builder'

import type {
  CatalogCachePort,
  CatalogItem,
} from '../application/catalog-cache.port'

const catalogItemCodec = createJsonRedisCodec<CatalogItem>(
  (value): value is CatalogItem =>
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'title' in value &&
    typeof value.title === 'string',
)

/** Fixture adapter proving a module-owned port can use the typed cache. */
export class RedisCatalogCacheAdapter implements CatalogCachePort {
  private readonly keys: RedisKeyBuilder

  public constructor(
    private readonly cache: RedisCacheClient,
    namespace: string,
  ) {
    this.keys = new RedisKeyBuilder(namespace, 'v1')
  }

  public get(id: string): Promise<CatalogItem | undefined> {
    return this.cache.get(this.key(id), catalogItemCodec)
  }

  public set(item: CatalogItem): Promise<void> {
    return this.cache.set(this.key(item.id), item, {
      codec: catalogItemCodec,
      ttlMs: 60_000,
      jitterRatio: 0.1,
    })
  }

  public invalidate(id: string): Promise<void> {
    return this.cache.invalidate(this.key(id))
  }

  private key(id: string): string {
    return this.keys.build('catalog', id)
  }
}
