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
    const forceExit = jest.fn()
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

    const input = {
      application: { close },
      shutdownGraceMs: 100,
      onStarted,
      forceExit,
      waitForTermination,
    }
    await runWorkerApplication(input)

    expect(calls).toEqual(['started', 'wait', 'close', 'waited'])
    expect(onStarted).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(waitForTermination).toHaveBeenCalledTimes(1)
    expect(forceExit).not.toHaveBeenCalled()
  })

  it('attempts close but preserves a startup failure', async () => {
    const startupFailure = new Error('worker startup failed')
    const close = jest.fn(() => Promise.resolve())
    const forceExit = jest.fn()
    const input = {
      application: { close },
      shutdownGraceMs: 100,
      onStarted: () => {
        throw startupFailure
      },
      forceExit,
    }

    await expect(runWorkerApplication(input)).rejects.toBe(startupFailure)
    expect(close).toHaveBeenCalledTimes(1)
    expect(forceExit).not.toHaveBeenCalled()
  })

  it('attempts close but preserves a waiter failure', async () => {
    const waiterFailure = new Error('worker waiter failed')
    const close = jest.fn(() => Promise.resolve())
    const forceExit = jest.fn()
    const input = {
      application: { close },
      shutdownGraceMs: 100,
      onStarted: jest.fn(),
      forceExit,
      waitForTermination: () => Promise.reject(waiterFailure),
    }

    await expect(runWorkerApplication(input)).rejects.toBe(waiterFailure)
    expect(close).toHaveBeenCalledTimes(1)
    expect(forceExit).not.toHaveBeenCalled()
  })

  it('surfaces a normal close failure and a close timeout', async () => {
    const closeFailure = new Error('worker close failed')
    const closeFailureForceExit = jest.fn()
    const closeFailureInput = {
      application: {
        close: jest.fn(() => Promise.reject(closeFailure)),
      },
      shutdownGraceMs: 100,
      onStarted: jest.fn(),
      forceExit: closeFailureForceExit,
      waitForTermination: (closeOnce: () => Promise<void>) => closeOnce(),
    }
    await expect(runWorkerApplication(closeFailureInput)).rejects.toBe(
      closeFailure,
    )
    expect(closeFailureForceExit).not.toHaveBeenCalled()

    const timeoutForceExit = jest.fn()
    const timeoutInput = {
      application: { close: () => new Promise<void>(() => undefined) },
      shutdownGraceMs: 1,
      onStarted: jest.fn(),
      forceExit: timeoutForceExit,
      waitForTermination: (closeOnce: () => Promise<void>) => closeOnce(),
    }
    await expect(runWorkerApplication(timeoutInput)).rejects.toThrow(
      'Worker application close exceeded shutdown grace',
    )
    expect(timeoutForceExit).toHaveBeenCalledTimes(1)
    expect(timeoutForceExit).toHaveBeenCalledWith(1)
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
