import { OutboxRetentionCleanup } from '@/platform/outbox/outbox-retention-cleanup'
import type { OutboxStorePort } from '@/platform/outbox/outbox.ports'

describe('OutboxRetentionCleanup', () => {
  it('deletes published rows in the bounded seven-day default window', async () => {
    const cleanupPublished = jest.fn(() => Promise.resolve(3))
    const store = { cleanupPublished } as Pick<
      OutboxStorePort,
      'cleanupPublished'
    >
    const cleanup = new OutboxRetentionCleanup(store as OutboxStorePort, {
      clock: () => new Date('2026-08-08T00:00:00.000Z'),
    })

    await expect(cleanup.runOnce()).resolves.toBe(3)

    expect(cleanupPublished).toHaveBeenCalledWith({
      before: new Date('2026-08-01T00:00:00.000Z'),
      limit: 500,
    })
  })
})
