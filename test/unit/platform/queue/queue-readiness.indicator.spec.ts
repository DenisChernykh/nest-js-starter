import { QueueReadinessIndicator } from '@/platform/queue/queue-readiness.indicator'

describe('QueueReadinessIndicator', () => {
  it('reports up after the queue client becomes ready', async () => {
    const waitUntilReady = jest.fn(() => Promise.resolve(undefined))
    const indicator = new QueueReadinessIndicator({ waitUntilReady }, 100)

    await expect(indicator.check(new AbortController().signal)).resolves.toBe(
      'up',
    )
    expect(waitUntilReady).toHaveBeenCalledTimes(1)
    expect(indicator.name).toBe('redis-queue')
    expect(indicator.required).toBe(true)
    expect(indicator.timeoutMs).toBe(100)
  })

  it('reports down when queue readiness rejects without exposing the error', async () => {
    const waitUntilReady = jest.fn(() =>
      Promise.reject(new Error('queue-password=secret')),
    )
    const indicator = new QueueReadinessIndicator({ waitUntilReady }, 100)

    await expect(indicator.check(new AbortController().signal)).resolves.toBe(
      'down',
    )
  })

  it('reports down when readiness exceeds the owned timeout', async () => {
    const waitUntilReady = jest.fn(() => new Promise<never>(() => undefined))
    const indicator = new QueueReadinessIndicator({ waitUntilReady }, 1)

    await expect(indicator.check(new AbortController().signal)).resolves.toBe(
      'down',
    )
  })

  it('reports down when the caller aborts and does not close the client', async () => {
    const waitUntilReady = jest.fn(() => new Promise<never>(() => undefined))
    const close = jest.fn()
    const controller = new AbortController()
    const client = { waitUntilReady, close }
    const indicator = new QueueReadinessIndicator(client, 100)

    const checking = indicator.check(controller.signal)
    controller.abort()

    await expect(checking).resolves.toBe('down')
    expect(close).not.toHaveBeenCalled()
  })
})
