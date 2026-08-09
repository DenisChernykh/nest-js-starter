import {
  type PeriodicMaintenanceEvent,
  type PeriodicMaintenanceOptions,
  PeriodicMaintenanceRunner,
} from '@/platform/maintenance/periodic-maintenance-runner'

const task = (): Promise<void> => Promise.resolve()

describe('PeriodicMaintenanceRunner', () => {
  it.each([
    [{ delayMs: 0, shutdownGraceMs: 0 }, 'zero delay'],
    [{ delayMs: -1, shutdownGraceMs: 0 }, 'negative delay'],
    [{ delayMs: 1.5, shutdownGraceMs: 0 }, 'fractional delay'],
    [
      { delayMs: Number.POSITIVE_INFINITY, shutdownGraceMs: 0 },
      'infinite delay',
    ],
    [{ delayMs: Number.NaN, shutdownGraceMs: 0 }, 'NaN delay'],
    [{ delayMs: 1, shutdownGraceMs: -1 }, 'negative shutdown grace'],
    [{ delayMs: 1, shutdownGraceMs: 1.5 }, 'fractional shutdown grace'],
    [
      { delayMs: 1, shutdownGraceMs: Number.POSITIVE_INFINITY },
      'infinite shutdown grace',
    ],
    [{ delayMs: 1, shutdownGraceMs: Number.NaN }, 'NaN shutdown grace'],
  ] satisfies readonly (readonly [PeriodicMaintenanceOptions, string])[])(
    'rejects %s options for %s',
    (options) => {
      expect(() => new PeriodicMaintenanceRunner(task, options)).toThrow(
        RangeError,
      )
    },
  )

  it('accepts finite integer durations above the native timer limit', () => {
    expect(
      () =>
        new PeriodicMaintenanceRunner(task, {
          delayMs: 2_147_483_648,
          shutdownGraceMs: 2_147_483_648,
        }),
    ).not.toThrow()
  })

  it('does not admit a cycle when the signal is already aborted', async () => {
    const runOnce = jest.fn(task)
    const controller = new AbortController()
    controller.abort()
    const runner = new PeriodicMaintenanceRunner(runOnce, {
      delayMs: 1,
      shutdownGraceMs: 0,
    })

    await runner.run(controller.signal)

    expect(runOnce).not.toHaveBeenCalled()
  })

  it('rejects a second run call without admitting another cycle', async () => {
    const runOnce = jest.fn(task)
    const controller = new AbortController()
    controller.abort()
    const runner = new PeriodicMaintenanceRunner(runOnce, {
      delayMs: 1,
      shutdownGraceMs: 0,
    })

    await runner.run(controller.signal)

    await expect(runner.run(controller.signal)).rejects.toThrow(
      'Periodic maintenance runner has already started',
    )
    expect(runOnce).not.toHaveBeenCalled()
  })

  it('starts the first cycle immediately by default', async () => {
    const controller = new AbortController()
    const receivedSignals: AbortSignal[] = []
    const runOnce = jest.fn((signal: AbortSignal) => {
      receivedSignals.push(signal)
      controller.abort()
      return Promise.resolve()
    })
    const runner = new PeriodicMaintenanceRunner(runOnce, {
      delayMs: 1_000,
      shutdownGraceMs: 100,
    })

    await runner.run(controller.signal)

    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(receivedSignals).toEqual([controller.signal])
  })

  it('waits one delay before the first cycle when runOnStart is false', async () => {
    jest.useFakeTimers()
    try {
      const controller = new AbortController()
      const runOnce = jest.fn(() => {
        controller.abort()
        return Promise.resolve()
      })
      const runner = new PeriodicMaintenanceRunner(runOnce, {
        delayMs: 1_000,
        shutdownGraceMs: 100,
        runOnStart: false,
      })

      const running = runner.run(controller.signal)
      await jest.advanceTimersByTimeAsync(999)
      expect(runOnce).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(1)
      await running

      expect(runOnce).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('chunks a delay above the native timer limit without starting early', async () => {
    jest.useFakeTimers()
    try {
      const controller = new AbortController()
      const runOnce = jest.fn(() => {
        controller.abort()
        return Promise.resolve()
      })
      const runner = new PeriodicMaintenanceRunner(runOnce, {
        delayMs: 2_147_483_648,
        shutdownGraceMs: 100,
        runOnStart: false,
      })

      const running = runner.run(controller.signal)
      await jest.advanceTimersByTimeAsync(2_147_483_647)
      expect(runOnce).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(1)
      await running

      expect(runOnce).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('waits the full delay after one cycle settles', async () => {
    jest.useFakeTimers()
    try {
      const controller = new AbortController()
      let cycle = 0
      const runOnce = jest.fn(() => {
        cycle += 1
        if (cycle === 2) controller.abort()
        return Promise.resolve()
      })
      const runner = new PeriodicMaintenanceRunner(runOnce, {
        delayMs: 1_000,
        shutdownGraceMs: 100,
      })

      const running = runner.run(controller.signal)
      await jest.advanceTimersByTimeAsync(999)
      expect(runOnce).toHaveBeenCalledTimes(1)

      await jest.advanceTimersByTimeAsync(1)
      await running

      expect(runOnce).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not overlap a cycle that has not settled', async () => {
    jest.useFakeTimers()
    try {
      let release: (() => void) | undefined
      const controller = new AbortController()
      const runOnce = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      )
      const runner = new PeriodicMaintenanceRunner(runOnce, {
        delayMs: 1_000,
        shutdownGraceMs: 100,
      })

      const running = runner.run(controller.signal)
      await Promise.resolve()
      await jest.advanceTimersByTimeAsync(5_000)

      expect(runOnce).toHaveBeenCalledTimes(1)

      controller.abort()
      release?.()
      await running
    } finally {
      jest.useRealTimers()
    }
  })

  it('stops an idle delay promptly when the signal aborts', async () => {
    jest.useFakeTimers()
    try {
      const controller = new AbortController()
      const runOnce = jest.fn(task)
      const runner = new PeriodicMaintenanceRunner(runOnce, {
        delayMs: 60_000,
        shutdownGraceMs: 100,
      })

      const running = runner.run(controller.signal)
      await jest.advanceTimersByTimeAsync(0)
      controller.abort()
      await running

      expect(runOnce).toHaveBeenCalledTimes(1)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not start a delayed first cycle after shutdown begins', async () => {
    jest.useFakeTimers()
    try {
      const controller = new AbortController()
      const runOnce = jest.fn(task)
      const runner = new PeriodicMaintenanceRunner(runOnce, {
        delayMs: 60_000,
        shutdownGraceMs: 100,
        runOnStart: false,
      })

      const running = runner.run(controller.signal)
      controller.abort()
      await running

      expect(runOnce).not.toHaveBeenCalled()
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('waits for an active cycle that settles inside the shutdown grace', async () => {
    jest.useFakeTimers()
    try {
      let release: (() => void) | undefined
      let receivedSignal: AbortSignal | undefined
      const controller = new AbortController()
      const runOnce = jest.fn(
        (signal: AbortSignal) =>
          new Promise<void>((resolve) => {
            receivedSignal = signal
            release = resolve
          }),
      )
      const runner = new PeriodicMaintenanceRunner(runOnce, {
        delayMs: 1_000,
        shutdownGraceMs: 100,
      })

      const running = runner.run(controller.signal)
      await Promise.resolve()
      controller.abort()

      expect(receivedSignal?.aborted).toBe(true)

      release?.()
      await running

      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('stops waiting when an active cycle exceeds the shutdown grace', async () => {
    jest.useFakeTimers()
    let release: (() => void) | undefined
    try {
      const controller = new AbortController()
      const runOnce = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      )
      const runner = new PeriodicMaintenanceRunner(runOnce, {
        delayMs: 1_000,
        shutdownGraceMs: 100,
      })
      let settled = false

      const running = runner.run(controller.signal).then(() => {
        settled = true
      })
      await Promise.resolve()
      controller.abort()

      await jest.advanceTimersByTimeAsync(99)
      expect(settled).toBe(false)

      await jest.advanceTimersByTimeAsync(1)
      expect(settled).toBe(true)

      await running
    } finally {
      release?.()
      await Promise.resolve()
      jest.useRealTimers()
    }
  })

  it('treats a cycle failure after shutdown wins as a normal drain', async () => {
    let rejectCycle: ((error: Error) => void) | undefined
    const controller = new AbortController()
    const error = new Error('failed while draining')
    const events: PeriodicMaintenanceEvent[] = []
    const runner = new PeriodicMaintenanceRunner(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCycle = reject
        }),
      {
        delayMs: 1_000,
        shutdownGraceMs: 100,
        observer: (event) => events.push(event),
      },
    )

    const running = runner.run(controller.signal)
    await Promise.resolve()
    controller.abort()
    rejectCycle?.(error)

    await expect(running).resolves.toBeUndefined()
    expect(events[0]).toEqual({ type: 'cycle_started' })
    expect(events[1]).toMatchObject({ type: 'cycle_failed', error })
  })

  it('rejects with the original asynchronous cycle error', async () => {
    const error = new Error('relay failed')
    const runOnce = jest.fn(() => Promise.reject(error))
    const runner = new PeriodicMaintenanceRunner(runOnce, {
      delayMs: 1_000,
      shutdownGraceMs: 100,
    })

    await expect(runner.run(new AbortController().signal)).rejects.toBe(error)
    expect(runOnce).toHaveBeenCalledTimes(1)
  })

  it('removes the abort listener after a cycle failure', async () => {
    const controller = new AbortController()
    const removeEventListener = jest.spyOn(
      controller.signal,
      'removeEventListener',
    )
    const runner = new PeriodicMaintenanceRunner(
      () => Promise.reject(new Error('cycle failed')),
      {
        delayMs: 1_000,
        shutdownGraceMs: 100,
      },
    )

    await expect(runner.run(controller.signal)).rejects.toThrow('cycle failed')

    expect(removeEventListener).toHaveBeenCalledWith(
      'abort',
      expect.any(Function),
    )
  })

  it('normalizes a synchronous task throw into the original rejection', async () => {
    const error = new Error('synchronous failure')
    const runOnce = jest.fn((): Promise<void> => {
      throw error
    })
    const runner = new PeriodicMaintenanceRunner(runOnce, {
      delayMs: 1_000,
      shutdownGraceMs: 100,
    })

    await expect(runner.run(new AbortController().signal)).rejects.toBe(error)
    expect(runOnce).toHaveBeenCalledTimes(1)
  })

  it('observes a successful cycle in lifecycle order', async () => {
    jest.useFakeTimers()
    try {
      let release: (() => void) | undefined
      const controller = new AbortController()
      const events: PeriodicMaintenanceEvent[] = []
      const runner = new PeriodicMaintenanceRunner(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
        {
          delayMs: 1_000,
          shutdownGraceMs: 100,
          observer: (event) => events.push(event),
        },
      )

      const running = runner.run(controller.signal)
      await Promise.resolve()
      await jest.advanceTimersByTimeAsync(25)
      release?.()
      await Promise.resolve()
      await Promise.resolve()
      controller.abort()
      await running

      expect(events).toEqual([
        { type: 'cycle_started' },
        { type: 'cycle_succeeded', durationMs: 25 },
      ])
    } finally {
      jest.useRealTimers()
    }
  })

  it('observes a failed cycle before preserving its error identity', async () => {
    const error = new Error('cycle failed')
    const events: PeriodicMaintenanceEvent[] = []
    const runner = new PeriodicMaintenanceRunner(() => Promise.reject(error), {
      delayMs: 1_000,
      shutdownGraceMs: 100,
      observer: (event) => events.push(event),
    })

    await expect(runner.run(new AbortController().signal)).rejects.toBe(error)

    expect(events[0]).toEqual({ type: 'cycle_started' })
    expect(events[1]).toMatchObject({ type: 'cycle_failed', error })
    expect(events[1]).toHaveProperty('durationMs', expect.any(Number))
  })

  it('does not let observer failures replace a task failure', async () => {
    const taskError = new Error('task failed')
    const observerError = new Error('observer failed')
    const observer = jest.fn(() => {
      throw observerError
    })
    const runner = new PeriodicMaintenanceRunner(
      () => Promise.reject(taskError),
      {
        delayMs: 1_000,
        shutdownGraceMs: 100,
        observer,
      },
    )

    await expect(runner.run(new AbortController().signal)).rejects.toBe(
      taskError,
    )
    expect(observer).toHaveBeenCalledTimes(2)
  })

  it('suppresses a rejected Promise returned by the observer', async () => {
    const controller = new AbortController()
    const observerError = new Error('asynchronous observer failure')
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (error: unknown): void => {
      unhandledRejections.push(error)
    }
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      const runner = new PeriodicMaintenanceRunner(
        () => {
          controller.abort()
          return Promise.resolve()
        },
        {
          delayMs: 1_000,
          shutdownGraceMs: 100,
          // TypeScript allows a Promise-returning callback at a void boundary.
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          observer: () => Promise.reject(observerError),
        },
      )

      await expect(runner.run(controller.signal)).resolves.toBeUndefined()
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(unhandledRejections).not.toContain(observerError)
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('emits only the grace event when a detached cycle rejects later', async () => {
    jest.useFakeTimers()
    let rejectCycle: ((error: Error) => void) | undefined
    try {
      const controller = new AbortController()
      const events: PeriodicMaintenanceEvent[] = []
      const runner = new PeriodicMaintenanceRunner(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectCycle = reject
          }),
        {
          delayMs: 1_000,
          shutdownGraceMs: 100,
          observer: (event) => events.push(event),
        },
      )

      const running = runner.run(controller.signal)
      await Promise.resolve()
      controller.abort()
      await jest.advanceTimersByTimeAsync(100)
      await running

      rejectCycle?.(new Error('late failure'))
      await Promise.resolve()

      expect(events).toEqual([
        { type: 'cycle_started' },
        { type: 'shutdown_grace_exceeded', graceMs: 100 },
      ])
    } finally {
      jest.useRealTimers()
    }
  })
})
