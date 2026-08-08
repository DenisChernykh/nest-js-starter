import { OutboxRelayRunner } from '@/platform/outbox/outbox-relay-runner'

describe('OutboxRelayRunner', () => {
  it('stops polling promptly when shutdown aborts during the poll wait', async () => {
    const relay = { runOnce: jest.fn(() => Promise.resolve(undefined)) }
    const controller = new AbortController()
    const runner = new OutboxRelayRunner(relay, 60_000)
    const running = runner.run(controller.signal)

    await Promise.resolve()
    controller.abort()
    await running

    expect(relay.runOnce).toHaveBeenCalledTimes(1)
  })

  it('bounds shutdown while one relay cycle is still running', async () => {
    let release: (() => void) | undefined
    const relay = {
      runOnce: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      ),
    }
    const controller = new AbortController()
    const runner = new OutboxRelayRunner(relay, 60_000, 0)
    const running = runner.run(controller.signal)

    await Promise.resolve()
    controller.abort()
    await running
    release?.()

    expect(relay.runOnce).toHaveBeenCalledTimes(1)
  })
})
