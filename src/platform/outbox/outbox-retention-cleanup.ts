import type { OutboxStorePort } from './outbox.ports'

export const outboxRetentionDefaults = Object.freeze({
  publishedRetentionMs: 7 * 24 * 60 * 60 * 1_000,
  cleanupBatchSize: 500,
})

export class OutboxRetentionCleanup {
  private readonly clock: () => Date
  private readonly publishedRetentionMs: number
  private readonly cleanupBatchSize: number

  public constructor(
    private readonly store: OutboxStorePort,
    options: {
      readonly clock?: () => Date
      readonly publishedRetentionMs?: number
      readonly cleanupBatchSize?: number
    } = {},
  ) {
    this.clock = options.clock ?? (() => new Date())
    this.publishedRetentionMs =
      options.publishedRetentionMs ??
      outboxRetentionDefaults.publishedRetentionMs
    this.cleanupBatchSize =
      options.cleanupBatchSize ?? outboxRetentionDefaults.cleanupBatchSize
  }

  public runOnce(): Promise<number> {
    return this.store.cleanupPublished({
      before: new Date(this.clock().getTime() - this.publishedRetentionMs),
      limit: this.cleanupBatchSize,
    })
  }
}
