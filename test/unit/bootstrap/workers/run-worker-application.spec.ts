import {
  runWorkerApplication,
  waitForWorkerTermination,
} from '@/bootstrap/workers/run-worker-application'
import type { WorkerTerminationWaiter } from '@/bootstrap/workers/run-worker-application'

describe('runWorkerApplication', () => {
  it('latches close, calls onStarted once and waits for the same close promise', async () => {
    const calls: string[] = []
    const close = jest.fn(() => {
      calls.push('close')
      return Promise.resolve()
    })
    const onStarted = jest.fn(() => {
      calls.push('started')
    })
    const waitForTermination: jest.MockedFunction<WorkerTerminationWaiter> =
      jest.fn()
    waitForTermination.mockImplementation(async (closeOnce) => {
      calls.push('wait')
      const first = closeOnce()
      const second = closeOnce()
      expect(second).toBe(first)
      await first
      calls.push('waited')
    })

    await runWorkerApplication({
      application: { close },
      shutdownGraceMs: 100,
      onStarted,
      waitForTermination,
    })

    expect(calls).toEqual(['started', 'wait', 'close', 'waited'])
    expect(onStarted).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(waitForTermination).toHaveBeenCalledTimes(1)
  })

  it('attempts close but preserves a startup failure', async () => {
    const startupFailure = new Error('worker startup failed')
    const close = jest.fn(() => Promise.resolve())

    await expect(
      runWorkerApplication({
        application: { close },
        shutdownGraceMs: 100,
        onStarted: () => {
          throw startupFailure
        },
      }),
    ).rejects.toBe(startupFailure)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('attempts close but preserves a waiter failure', async () => {
    const waiterFailure = new Error('worker waiter failed')
    const close = jest.fn(() => Promise.resolve())

    await expect(
      runWorkerApplication({
        application: { close },
        shutdownGraceMs: 100,
        onStarted: jest.fn(),
        waitForTermination: () => Promise.reject(waiterFailure),
      }),
    ).rejects.toBe(waiterFailure)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('surfaces a normal close failure and a close timeout', async () => {
    const closeFailure = new Error('worker close failed')
    await expect(
      runWorkerApplication({
        application: {
          close: jest.fn(() => Promise.reject(closeFailure)),
        },
        shutdownGraceMs: 100,
        onStarted: jest.fn(),
        waitForTermination: (closeOnce) => closeOnce(),
      }),
    ).rejects.toBe(closeFailure)

    await expect(
      runWorkerApplication({
        application: { close: () => new Promise<void>(() => undefined) },
        shutdownGraceMs: 1,
        onStarted: jest.fn(),
        waitForTermination: (closeOnce) => closeOnce(),
      }),
    ).rejects.toThrow('Worker application close exceeded shutdown grace')
  })
})

describe('waitForWorkerTermination', () => {
  it('accepts only the first signal and removes both listeners after close', async () => {
    const close = jest.fn(() => Promise.resolve())
    const waiting = waitForWorkerTermination(close)

    process.emit('SIGINT')
    process.emit('SIGTERM')

    await expect(waiting).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledTimes(1)

    process.emit('SIGINT')
    process.emit('SIGTERM')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
