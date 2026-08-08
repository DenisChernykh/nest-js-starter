import { OutboxRetentionCleanup } from '@/platform/outbox/outbox-retention-cleanup'
import type { OutboxStorePort } from '@/platform/outbox/outbox.ports'

describe('OutboxRetentionCleanup', () => {
  it('deletes published rows in the bounded seven-day default window', async () => {
    const cleanupPublished = jest.fn(() => Promise.resolve(3))
    const store = { cleanupPublished } as Pick<
      OutboxStorePort,
      'cleanupPublished'
    >
    const cleanup = new OutboxRetentionCleanup(store as OutboxStorePort)

    await expect(cleanup.runOnce()).resolves.toBe(3)

    expect(cleanupPublished).toHaveBeenCalledWith({
      retentionMs: 7 * 24 * 60 * 60 * 1_000,
      limit: 500,
    })
  })
})
