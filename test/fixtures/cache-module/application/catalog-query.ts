import type { TransactionPort } from '@/shared/application/transaction.port'

import type { CatalogCachePort, CatalogItem } from './catalog-cache.port'

/** Fixture cache-aside query kept outside production starter behavior. */
export class CatalogQuery {
  public constructor(
    private readonly cache: CatalogCachePort,
    private readonly load: (id: string) => Promise<CatalogItem>,
  ) {}

  /** Returns a cached item or loads and caches its immutable source value. */
  public async execute(id: string): Promise<CatalogItem> {
    const cached = await this.cache.get(id)
    if (cached !== undefined) return cached
    const item = await this.load(id)
    await this.cache.set(item)
    return item
  }
}

/** Fixture write service that invalidates only after durable work commits. */
export class CatalogWriteService {
  public constructor(
    private readonly transaction: TransactionPort,
    private readonly cache: CatalogCachePort,
    private readonly persist: (item: CatalogItem) => Promise<void>,
  ) {}

  /** Persists atomically, then completes exact-key invalidation before return. */
  public async update(item: CatalogItem): Promise<void> {
    await this.transaction.run(() => this.persist(item))
    await this.cache.invalidate(item.id)
  }
}
