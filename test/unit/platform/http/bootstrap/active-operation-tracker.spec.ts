import { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'

describe('ActiveOperationTracker', () => {
  it('aborts without claiming settlement and becomes idle only on complete', async () => {
    const tracker = new ActiveOperationTracker()
    const lease = tracker.begin()
    expect(tracker.activeCount).toBe(1)
    tracker.abortAll()
    expect(lease.signal.aborted).toBe(true)
    expect(tracker.activeCount).toBe(1)
    const waiting = tracker.waitForIdle(AbortSignal.timeout(100))
    lease.complete()
    lease.complete()
    await expect(waiting).resolves.toBe(true)
    expect(tracker.activeCount).toBe(0)
  })

  it('reports deadline while an operation remains unsettled', async () => {
    const tracker = new ActiveOperationTracker()
    const lease = tracker.begin()
    await expect(tracker.waitForIdle(AbortSignal.timeout(5))).resolves.toBe(
      false,
    )
    lease.complete()
  })
})
