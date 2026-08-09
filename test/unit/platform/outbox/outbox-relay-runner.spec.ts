import { OutboxRelayRunner } from '@/platform/outbox/outbox-relay-runner'

describe('OutboxRelayRunner', () => {
  it('preserves the 1 second default poll interval', async () => {
    jest.useFakeTimers()
    try {
      const controller = new AbortController()
      const relay = {
        runOnce: jest.fn(() => {
          if (relay.runOnce.mock.calls.length === 2) controller.abort()
          return Promise.resolve()
        }),
      }
      const runner = new OutboxRelayRunner(relay)

      const running = runner.run(controller.signal)
      await jest.advanceTimersByTimeAsync(999)
      expect(relay.runOnce).toHaveBeenCalledTimes(1)

      await jest.advanceTimersByTimeAsync(1)
      await running

      expect(relay.runOnce).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
  })

  it('preserves the 10 second default shutdown grace', async () => {
    jest.useFakeTimers()
    let release: (() => void) | undefined
    try {
      const controller = new AbortController()
      const relay = {
        runOnce: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              release = resolve
            }),
        ),
      }
      const runner = new OutboxRelayRunner(relay)
      let stopped = false

      const running = runner.run(controller.signal).then(() => {
        stopped = true
      })
      await Promise.resolve()
      controller.abort()

      await jest.advanceTimersByTimeAsync(9_999)
      expect(stopped).toBe(false)

      await jest.advanceTimersByTimeAsync(1)
      await running
      expect(stopped).toBe(true)
    } finally {
      release?.()
      await Promise.resolve()
      jest.useRealTimers()
    }
  })

  it('preserves a synchronous relay failure as the runner rejection', async () => {
    const error = new Error('relay failed synchronously')
    const relay = {
      runOnce: jest.fn((): Promise<void> => {
        throw error
      }),
    }
    const runner = new OutboxRelayRunner(relay)

    await expect(runner.run(new AbortController().signal)).rejects.toBe(error)
    expect(relay.runOnce).toHaveBeenCalledTimes(1)
  })

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

  it('clears the shutdown grace timer when the relay cycle settles early', async () => {
    jest.useFakeTimers()
    try {
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
      const runner = new OutboxRelayRunner(relay, 60_000, 10_000)
      const running = runner.run(controller.signal)

      await Promise.resolve()
      controller.abort()
      await Promise.resolve()
      release?.()
      await running

      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })
})
