/** Immutable fixture read model used only to prove the cache contract. */
export interface CatalogItem {
  readonly id: string
  readonly title: string
}

/** Module-owned cache port that does not expose Redis infrastructure. */
export interface CatalogCachePort {
  /** Returns one validated cached item or a cache miss. */
  get(id: string): Promise<CatalogItem | undefined>
  /** Stores one immutable item with the adapter-owned finite policy. */
  set(item: CatalogItem): Promise<void>
  /** Invalidates exactly one item key. */
  invalidate(id: string): Promise<void>
}
