import {
  BoundedOutboundHttpRunner,
  type BoundedOutboundHttpRunnerEvent,
  type BoundedOutboundHttpRunnerOptions,
  type OutboundHttpAttempt,
  type OutboundHttpOutcomeClassifier,
  type OutboundHttpRunResult,
  type OutboundHttpRunnerObserver,
} from '@/platform/http/outbound/bounded-outbound-http-runner'
import type { OutboundHttpAttemptOutcome } from '@/platform/http/outbound/fetch-outbound-http-attempt-transport'

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

interface ControlledThenable<T> {
  readonly promise: Promise<T>
  readonly subscribed: Promise<void>
  readonly fulfill: (value: T) => void
  readonly reject: (error: unknown) => void
}

function controlledThenable<T>(): ControlledThenable<T> {
  const subscription = deferred<void>()
  let fulfillSubscriber: ((value: T) => void) | undefined
  let rejectSubscriber: ((error: unknown) => void) | undefined
  const promise = {
    then(
      onFulfilled: (value: T) => unknown,
      onRejected: (error: unknown) => unknown,
    ): void {
      fulfillSubscriber = (value) => {
        void onFulfilled(value)
      }
      rejectSubscriber = (error) => {
        void onRejected(error)
      }
      subscription.resolve()
    },
  } as unknown as Promise<T>

  return {
    promise,
    subscribed: subscription.promise,
    fulfill: (value) => {
      if (fulfillSubscriber === undefined) {
        throw new Error('Controlled thenable has no fulfillment subscriber')
      }
      fulfillSubscriber(value)
    },
    reject: (error) => {
      if (rejectSubscriber === undefined) {
        throw new Error('Controlled thenable has no rejection subscriber')
      }
      rejectSubscriber(error)
    },
  }
}

const responseOutcome = {
  type: 'response',
  status: 503,
  headers: new Headers({ 'retry-after': '1' }),
  body: { type: 'ignored' },
  durationMs: 4,
} satisfies OutboundHttpAttemptOutcome

function compileTimeContract(): void {
  const attempt: OutboundHttpAttempt = ({ attempt, signal }) => {
    void attempt
    void signal
    return Promise.resolve(responseOutcome)
  }
  const classifier: OutboundHttpOutcomeClassifier = (outcome, context) => {
    void outcome
    void context
    return { type: 'succeed' }
  }
  const observer: OutboundHttpRunnerObserver = (
    event: BoundedOutboundHttpRunnerEvent,
  ): void => {
    void event
  }
  const options: BoundedOutboundHttpRunnerOptions = {
    maxAttempts: 1,
    deadlineMs: 1,
    observer,
  }
  const runner = new BoundedOutboundHttpRunner(options)
  const run: (
    attempt: OutboundHttpAttempt,
    classifier: OutboundHttpOutcomeClassifier,
    signal: AbortSignal,
  ) => Promise<OutboundHttpRunResult> = runner.run.bind(runner)

  const asynchronousClassifier: OutboundHttpOutcomeClassifier = () =>
    // @ts-expect-error The classifier contract is synchronous.
    Promise.resolve({ type: 'succeed' as const })
  // @ts-expect-error run requires the outer signal.
  const missingSignal = runner.run(attempt, classifier)

  void run
  void asynchronousClassifier
  void missingSignal
}

void compileTimeContract

describe('BoundedOutboundHttpRunner', () => {
  it.each([
    { maxAttempts: 0, deadlineMs: 1 },
    { maxAttempts: -1, deadlineMs: 1 },
    { maxAttempts: 1.5, deadlineMs: 1 },
    { maxAttempts: Number.POSITIVE_INFINITY, deadlineMs: 1 },
    { maxAttempts: Number.NaN, deadlineMs: 1 },
    { maxAttempts: Number.MAX_SAFE_INTEGER + 1, deadlineMs: 1 },
    { maxAttempts: 1, deadlineMs: 0 },
    { maxAttempts: 1, deadlineMs: -1 },
    { maxAttempts: 1, deadlineMs: 1.5 },
    { maxAttempts: 1, deadlineMs: Number.POSITIVE_INFINITY },
    { maxAttempts: 1, deadlineMs: Number.NaN },
    { maxAttempts: 1, deadlineMs: 2_147_483_648 },
  ] satisfies readonly BoundedOutboundHttpRunnerOptions[])(
    'rejects invalid constructor options %p without starting a timer',
    (options) => {
      jest.useFakeTimers()
      try {
        expect(() => new BoundedOutboundHttpRunner(options)).toThrow(RangeError)
        expect(jest.getTimerCount()).toBe(0)
      } finally {
        jest.useRealTimers()
      }
    },
  )

  it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, 2_147_483_648])(
    'rejects invalid retry delay %p before admitting another attempt',
    async (nextDelayMs) => {
      const attempt = jest.fn(() => Promise.resolve(responseOutcome))
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 2,
        deadlineMs: 1_000,
      })

      await expect(
        runner.run(
          attempt,
          () => ({ type: 'retry', nextDelayMs }),
          new AbortController().signal,
        ),
      ).rejects.toThrow(RangeError)

      expect(attempt).toHaveBeenCalledTimes(1)
    },
  )

  it('validates an invalid retry delay before final-attempt exhaustion', async () => {
    const attempt = jest.fn(() => Promise.resolve(responseOutcome))
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 1,
      deadlineMs: 1_000,
    })

    await expect(
      runner.run(
        attempt,
        () => ({ type: 'retry', nextDelayMs: -1 }),
        new AbortController().signal,
      ),
    ).rejects.toThrow(RangeError)

    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('passes exact attempt and classifier contexts across an immediate retry', async () => {
    const attemptContexts: Array<{ attempt: number; signal: AbortSignal }> = []
    const classifierContexts: Array<{
      attempt: number
      remainingAttempts: number
      remainingMs: number
    }> = []
    const productPolicy = { acceptedStatus: 503 }
    const attempt: OutboundHttpAttempt = (context) => {
      attemptContexts.push(context)
      return Promise.resolve(responseOutcome)
    }
    const classifier: OutboundHttpOutcomeClassifier = (outcome, context) => {
      classifierContexts.push(context)
      if (
        context.attempt === 1 &&
        outcome.type === 'response' &&
        outcome.status === productPolicy.acceptedStatus
      ) {
        return { type: 'retry' }
      }
      return { type: 'succeed' }
    }
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 2,
      deadlineMs: 1_000,
    })

    const result = await runner.run(
      attempt,
      classifier,
      new AbortController().signal,
    )

    expect(runner.run.bind(runner)).toHaveLength(3)
    expect(attemptContexts.map(({ attempt: number }) => number)).toEqual([1, 2])
    expect(attemptContexts[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(attemptContexts[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(attemptContexts[1]?.signal).not.toBe(attemptContexts[0]?.signal)
    expect(classifierContexts).toHaveLength(2)
    expect(classifierContexts[0]).toMatchObject({
      attempt: 1,
      remainingAttempts: 1,
    })
    expect(classifierContexts[1]).toMatchObject({
      attempt: 2,
      remainingAttempts: 0,
    })
    for (const context of classifierContexts) {
      expect(Number.isFinite(context.remainingMs)).toBe(true)
      expect(context.remainingMs).toBeGreaterThanOrEqual(0)
      expect(context.remainingMs).toBeLessThanOrEqual(1_000)
    }
    expect(result).toEqual({
      type: 'succeeded',
      outcome: responseOutcome,
      attempts: 2,
    })
  })

  it.each([
    [
      { type: 'succeed' } as const,
      { type: 'succeeded', outcome: responseOutcome, attempts: 1 } as const,
    ],
    [
      { type: 'fail' } as const,
      {
        type: 'failed',
        reason: 'terminal',
        outcome: responseOutcome,
        attempts: 1,
      } as const,
    ],
    [
      { type: 'retry' } as const,
      {
        type: 'failed',
        reason: 'exhausted',
        outcome: responseOutcome,
        attempts: 1,
      } as const,
    ],
  ])(
    'returns the classifier-selected result for %p',
    async (decision, expected) => {
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 1,
        deadlineMs: 1_000,
      })

      const result = await runner.run(
        () => Promise.resolve(responseOutcome),
        () => decision,
        new AbortController().signal,
      )

      expect(result).toEqual(expected)
    },
  )

  it('waits an explicit retry delay before admitting the next attempt', async () => {
    jest.useFakeTimers()
    try {
      const attempt = jest.fn(() => Promise.resolve(responseOutcome))
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 2,
        deadlineMs: 1_000,
      })
      const running = runner.run(
        attempt,
        (_outcome, { attempt: attemptNumber }) =>
          attemptNumber === 1
            ? { type: 'retry', nextDelayMs: 100 }
            : { type: 'succeed' },
        new AbortController().signal,
      )

      await jest.advanceTimersByTimeAsync(99)
      expect(attempt).toHaveBeenCalledTimes(1)

      await jest.advanceTimersByTimeAsync(1)
      await expect(running).resolves.toMatchObject({
        type: 'succeeded',
        attempts: 2,
      })
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('returns deadline_exceeded during backoff without admitting another attempt', async () => {
    jest.useFakeTimers()
    try {
      const attempt = jest.fn(() => Promise.resolve(responseOutcome))
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 3,
        deadlineMs: 100,
      })
      const running = runner.run(
        attempt,
        () => ({ type: 'retry', nextDelayMs: 1_000 }),
        new AbortController().signal,
      )

      await jest.advanceTimersByTimeAsync(100)

      await expect(running).resolves.toEqual({
        type: 'deadline_exceeded',
        attempts: 1,
      })
      expect(attempt).toHaveBeenCalledTimes(1)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('returns aborted during backoff and clears the pending delay', async () => {
    jest.useFakeTimers()
    try {
      const outer = new AbortController()
      const attempt = jest.fn(() => Promise.resolve(responseOutcome))
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 3,
        deadlineMs: 1_000,
      })
      const running = runner.run(
        attempt,
        () => ({ type: 'retry', nextDelayMs: 500 }),
        outer.signal,
      )
      await jest.advanceTimersByTimeAsync(0)

      outer.abort(new Error('stop during backoff'))

      await expect(running).resolves.toEqual({ type: 'aborted', attempts: 1 })
      expect(attempt).toHaveBeenCalledTimes(1)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('uses one absolute deadline across attempts and aborts active work', async () => {
    jest.useFakeTimers()
    const secondAttempt = deferred<OutboundHttpAttemptOutcome>()
    try {
      const attemptSignals: AbortSignal[] = []
      const attempt: OutboundHttpAttempt = ({ attempt: number, signal }) => {
        attemptSignals.push(signal)
        if (number === 1) {
          return new Promise((resolve) => {
            setTimeout(() => resolve(responseOutcome), 60)
          })
        }
        return secondAttempt.promise
      }
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 3,
        deadlineMs: 100,
      })
      const running = runner.run(
        attempt,
        () => ({ type: 'retry' }),
        new AbortController().signal,
      )
      let observed: OutboundHttpRunResult | undefined
      void running.then((result) => {
        observed = result
      })

      await jest.advanceTimersByTimeAsync(60)
      expect(attemptSignals).toHaveLength(2)

      await jest.advanceTimersByTimeAsync(40)

      expect(observed).toEqual({ type: 'deadline_exceeded', attempts: 2 })
      expect(attemptSignals[1]?.aborted).toBe(true)

      secondAttempt.reject(new Error('late attempt rejection'))
      await Promise.resolve()
      expect(attemptSignals).toHaveLength(2)
    } finally {
      secondAttempt.resolve(responseOutcome)
      jest.useRealTimers()
    }
  })

  it('schedules the deadline from the remaining absolute budget after setup', async () => {
    jest.useFakeTimers()
    const pending = deferred<OutboundHttpAttemptOutcome>()
    const now = jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(25)
    try {
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 1,
        deadlineMs: 100,
      })
      const running = runner.run(
        () => pending.promise,
        () => ({ type: 'succeed' }),
        new AbortController().signal,
      )
      let observed: OutboundHttpRunResult | undefined
      void running.then((result) => {
        observed = result
      })

      await jest.advanceTimersByTimeAsync(75)
      const resultAtAbsoluteDeadline = observed

      if (resultAtAbsoluteDeadline === undefined) {
        pending.resolve(responseOutcome)
        await running
      } else {
        pending.reject(new Error('late settlement after absolute deadline'))
        await Promise.resolve()
      }

      expect(resultAtAbsoluteDeadline).toEqual({
        type: 'deadline_exceeded',
        attempts: 1,
      })
    } finally {
      now.mockRestore()
      pending.resolve(responseOutcome)
      jest.useRealTimers()
    }
  })

  it('returns aborted from active work and consumes its late rejection', async () => {
    const pending = deferred<OutboundHttpAttemptOutcome>()
    const outer = new AbortController()
    let attemptSignal: AbortSignal | undefined
    const classifier = jest.fn<
      ReturnType<OutboundHttpOutcomeClassifier>,
      Parameters<OutboundHttpOutcomeClassifier>
    >(() => ({ type: 'succeed' }))
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 2,
      deadlineMs: 60_000,
    })
    const running = runner.run(
      ({ signal }) => {
        attemptSignal = signal
        return pending.promise
      },
      classifier,
      outer.signal,
    )
    let observed: OutboundHttpRunResult | undefined
    void running.then(
      (result) => {
        observed = result
      },
      () => undefined,
    )
    await Promise.resolve()

    outer.abort(new Error('stop active attempt'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    pending.reject(new Error('late attempt failure'))
    await running.catch(() => undefined)

    expect(observed).toEqual({ type: 'aborted', attempts: 1 })
    expect(attemptSignal?.aborted).toBe(true)
    expect(classifier).not.toHaveBeenCalled()
  })

  it('does not classify an outcome returned synchronously from child abort', async () => {
    const release = deferred<OutboundHttpAttemptOutcome>()
    const outer = new AbortController()
    const classifier = jest.fn<
      ReturnType<OutboundHttpOutcomeClassifier>,
      Parameters<OutboundHttpOutcomeClassifier>
    >(() => ({ type: 'succeed' }))
    let attemptSignal: AbortSignal | undefined
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 1,
      deadlineMs: 60_000,
    })
    const running = runner.run(
      ({ signal }) => {
        attemptSignal = signal
        signal.addEventListener(
          'abort',
          () => release.resolve({ type: 'aborted', durationMs: 0 }),
          { once: true },
        )
        return release.promise
      },
      classifier,
      outer.signal,
    )
    let observed: OutboundHttpRunResult | undefined
    void running.then((result) => {
      observed = result
    })
    await Promise.resolve()

    outer.abort()
    await new Promise<void>((resolve) => setImmediate(resolve))
    if (observed === undefined) {
      release.resolve({ type: 'aborted', durationMs: 0 })
      await running
    }

    expect(observed).toEqual({ type: 'aborted', attempts: 1 })
    expect(attemptSignal?.aborted).toBe(true)
    expect(classifier).not.toHaveBeenCalled()
  })

  it('preserves an ordinary Promise outcome settled before an immediate outer abort', async () => {
    const pending = deferred<OutboundHttpAttemptOutcome>()
    const subscribed = deferred<void>()
    const outer = new AbortController()
    const events: BoundedOutboundHttpRunnerEvent[] = []
    const classifier = jest.fn<
      ReturnType<OutboundHttpOutcomeClassifier>,
      Parameters<OutboundHttpOutcomeClassifier>
    >(() => ({ type: 'succeed' }))
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 2,
      deadlineMs: 1_000,
      observer: (event) => events.push(event),
    })
    const running = runner.run(
      () => {
        subscribed.resolve()
        return pending.promise
      },
      classifier,
      outer.signal,
    )
    await subscribed.promise

    pending.resolve(responseOutcome)
    outer.abort(new Error('outer abort after attempt settlement'))

    await expect(running).resolves.toEqual({
      type: 'succeeded',
      outcome: responseOutcome,
      attempts: 1,
    })
    expect(classifier).toHaveBeenCalledTimes(1)
    expect(events.map(({ type }) => type)).toEqual([
      'attempt_started',
      'attempt_finished',
      'run_finished',
    ])
  })

  it('preserves an ordinary Promise rejection before an immediate outer abort', async () => {
    const pending = deferred<OutboundHttpAttemptOutcome>()
    const subscribed = deferred<void>()
    const outer = new AbortController()
    const error = new Error('attempt rejected before outer abort')
    const events: BoundedOutboundHttpRunnerEvent[] = []
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 2,
      deadlineMs: 1_000,
      observer: (event) => events.push(event),
    })
    const running = runner.run(
      () => {
        subscribed.resolve()
        return pending.promise
      },
      () => ({ type: 'succeed' }),
      outer.signal,
    )
    await subscribed.promise

    pending.reject(error)
    outer.abort(new Error('outer abort after attempt rejection'))

    await expect(running).rejects.toBe(error)
    expect(events.map(({ type }) => type)).toEqual(['attempt_started'])
  })

  it('preserves a settlement-first typed outcome when outer abort queues before continuation', async () => {
    const controlled = controlledThenable<OutboundHttpAttemptOutcome>()
    const outer = new AbortController()
    const events: BoundedOutboundHttpRunnerEvent[] = []
    const classifier = jest.fn<
      ReturnType<OutboundHttpOutcomeClassifier>,
      Parameters<OutboundHttpOutcomeClassifier>
    >(() => ({ type: 'succeed' }))
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 2,
      deadlineMs: 1_000,
      observer: (event) => events.push(event),
    })
    const running = runner.run(
      () => controlled.promise,
      classifier,
      outer.signal,
    )
    await controlled.subscribed

    controlled.fulfill(responseOutcome)
    queueMicrotask(() => outer.abort(new Error('late outer abort')))

    await expect(running).resolves.toEqual({
      type: 'succeeded',
      outcome: responseOutcome,
      attempts: 1,
    })
    expect(classifier).toHaveBeenCalledTimes(1)
    expect(events.map(({ type }) => type)).toEqual([
      'attempt_started',
      'attempt_finished',
      'run_finished',
    ])
  })

  it('preserves a settlement-first attempt error when outer abort queues before continuation', async () => {
    const controlled = controlledThenable<OutboundHttpAttemptOutcome>()
    const outer = new AbortController()
    const error = new Error('attempt failed before late abort')
    const events: BoundedOutboundHttpRunnerEvent[] = []
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 2,
      deadlineMs: 1_000,
      observer: (event) => events.push(event),
    })
    const running = runner.run(
      () => controlled.promise,
      () => ({ type: 'succeed' }),
      outer.signal,
    )
    await controlled.subscribed

    controlled.reject(error)
    queueMicrotask(() => outer.abort(new Error('late outer abort')))

    await expect(running).rejects.toBe(error)
    expect(events.map(({ type }) => type)).toEqual(['attempt_started'])
  })

  it('keeps a latched deadline authoritative when child abort cascades to outer abort', async () => {
    jest.useFakeTimers()
    const pending = deferred<OutboundHttpAttemptOutcome>()
    try {
      const outer = new AbortController()
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 1,
        deadlineMs: 25,
      })
      const running = runner.run(
        ({ signal }) => {
          signal.addEventListener('abort', () => outer.abort(), { once: true })
          return pending.promise
        },
        () => ({ type: 'succeed' }),
        outer.signal,
      )

      await jest.advanceTimersByTimeAsync(25)

      await expect(running).resolves.toEqual({
        type: 'deadline_exceeded',
        attempts: 1,
      })
      expect(outer.signal.aborted).toBe(true)

      pending.reject(new Error('late attempt rejection'))
      await Promise.resolve()
    } finally {
      pending.resolve(responseOutcome)
      jest.useRealTimers()
    }
  })

  it('gives an already-aborted outer signal precedence over attempt admission', async () => {
    const outer = new AbortController()
    outer.abort()
    const attempt = jest.fn(() => Promise.resolve(responseOutcome))
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 1,
      deadlineMs: 1,
    })

    await expect(
      runner.run(attempt, () => ({ type: 'succeed' }), outer.signal),
    ).resolves.toEqual({ type: 'aborted', attempts: 0 })
    expect(attempt).not.toHaveBeenCalled()
  })

  it.each(['attempt rejection', 'attempt throw', 'classifier throw'])(
    'propagates the original callback error for %s',
    async (caseName) => {
      const error = new Error(caseName)
      const attempt: OutboundHttpAttempt =
        caseName === 'attempt rejection'
          ? () => Promise.reject(error)
          : caseName === 'attempt throw'
            ? () => {
                throw error
              }
            : () => Promise.resolve(responseOutcome)
      const classifier: OutboundHttpOutcomeClassifier =
        caseName === 'classifier throw'
          ? () => {
              throw error
            }
          : () => ({ type: 'succeed' })
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 1,
        deadlineMs: 1_000,
      })

      await expect(
        runner.run(attempt, classifier, new AbortController().signal),
      ).rejects.toBe(error)
    },
  )

  it('emits only the exact safe lifecycle metadata for a successful retry', async () => {
    jest.useFakeTimers()
    try {
      const events: BoundedOutboundHttpRunnerEvent[] = []
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 2,
        deadlineMs: 1_000,
        observer: (event) => events.push(event),
      })
      const running = runner.run(
        () => Promise.resolve(responseOutcome),
        (_outcome, { attempt }) =>
          attempt === 1
            ? { type: 'retry', nextDelayMs: 100 }
            : { type: 'succeed' },
        new AbortController().signal,
      )

      await jest.advanceTimersByTimeAsync(100)
      await running

      expect(events).toEqual([
        { type: 'attempt_started', attempt: 1, remainingMs: 1_000 },
        {
          type: 'attempt_finished',
          attempt: 1,
          category: 'response',
          status: 503,
          bodyState: 'ignored',
          durationMs: 4,
        },
        {
          type: 'retry_scheduled',
          attempt: 1,
          delayMs: 100,
          remainingMs: 1_000,
        },
        { type: 'attempt_started', attempt: 2, remainingMs: 900 },
        {
          type: 'attempt_finished',
          attempt: 2,
          category: 'response',
          status: 503,
          bodyState: 'ignored',
          durationMs: 4,
        },
        { type: 'run_finished', result: 'succeeded', attempts: 2 },
      ])
      expect(events.map((event) => event.type)).toEqual([
        'attempt_started',
        'attempt_finished',
        'retry_scheduled',
        'attempt_started',
        'attempt_finished',
        'run_finished',
      ])
      expect(Object.keys(events[0] ?? {}).sort()).toEqual([
        'attempt',
        'remainingMs',
        'type',
      ])
      expect(Object.keys(events[1] ?? {}).sort()).toEqual([
        'attempt',
        'bodyState',
        'category',
        'durationMs',
        'status',
        'type',
      ])
    } finally {
      jest.useRealTimers()
    }
  })

  it.each([
    [
      { type: 'fail' } as const,
      {
        type: 'run_finished',
        result: 'failed',
        attempts: 1,
        failureReason: 'terminal',
      } as const,
    ],
    [
      { type: 'retry' } as const,
      {
        type: 'run_finished',
        result: 'failed',
        attempts: 1,
        failureReason: 'exhausted',
      } as const,
    ],
  ])(
    'emits one failure event and no final retry event for %p',
    async (decision, finishedEvent) => {
      const events: BoundedOutboundHttpRunnerEvent[] = []
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 1,
        deadlineMs: 1_000,
        observer: (event) => events.push(event),
      })

      await runner.run(
        () => Promise.resolve(responseOutcome),
        () => decision,
        new AbortController().signal,
      )

      expect(events.filter(({ type }) => type === 'retry_scheduled')).toEqual(
        [],
      )
      expect(events.at(-1)).toEqual(finishedEvent)
      expect(events.filter(({ type }) => type === 'run_finished')).toHaveLength(
        1,
      )
    },
  )

  it('emits run_finished for an outer signal aborted before admission', async () => {
    const outer = new AbortController()
    outer.abort()
    const events: BoundedOutboundHttpRunnerEvent[] = []
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 1,
      deadlineMs: 1_000,
      observer: (event) => events.push(event),
    })

    await runner.run(
      () => Promise.resolve(responseOutcome),
      () => ({ type: 'succeed' }),
      outer.signal,
    )

    expect(events).toEqual([
      { type: 'run_finished', result: 'aborted', attempts: 0 },
    ])
  })

  it.each(['attempt rejection', 'classifier throw', 'invalid retry delay'])(
    'does not emit run_finished for the contract error %s',
    async (caseName) => {
      const error = new Error(caseName)
      const events: BoundedOutboundHttpRunnerEvent[] = []
      const runner = new BoundedOutboundHttpRunner({
        maxAttempts: 2,
        deadlineMs: 1_000,
        observer: (event) => events.push(event),
      })
      const attempt: OutboundHttpAttempt =
        caseName === 'attempt rejection'
          ? () => Promise.reject(error)
          : () => Promise.resolve(responseOutcome)
      const classifier: OutboundHttpOutcomeClassifier =
        caseName === 'classifier throw'
          ? () => {
              throw error
            }
          : caseName === 'invalid retry delay'
            ? () => ({ type: 'retry', nextDelayMs: -1 })
            : () => ({ type: 'succeed' })

      await expect(
        runner.run(attempt, classifier, new AbortController().signal),
      ).rejects.toBeInstanceOf(Error)

      expect(events.filter(({ type }) => type === 'run_finished')).toHaveLength(
        0,
      )
      expect(
        events.filter(({ type }) => type === 'retry_scheduled'),
      ).toHaveLength(0)
    },
  )

  it('suppresses synchronous observer errors without changing the result', async () => {
    const observer = jest.fn((event: BoundedOutboundHttpRunnerEvent): void => {
      void event
      throw new Error('observer failed')
    })
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 1,
      deadlineMs: 1_000,
      observer,
    })

    await expect(
      runner.run(
        () => Promise.resolve(responseOutcome),
        () => ({ type: 'succeed' }),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ type: 'succeeded' })
    expect(observer).toHaveBeenCalledTimes(3)
  })

  it('consumes a rejected runtime Promise-like observer result without awaiting it', async () => {
    const then = jest.fn(
      (
        _resolve: (value: unknown) => void,
        reject: (error: unknown) => void,
      ): void => reject(new Error('observer rejected')),
    )
    const observer = (() => ({ then })) as unknown as OutboundHttpRunnerObserver
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 1,
      deadlineMs: 1_000,
      observer,
    })

    await expect(
      runner.run(
        () => Promise.resolve(responseOutcome),
        () => ({ type: 'succeed' }),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ type: 'succeeded' })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(then).toHaveBeenCalledTimes(3)
  })

  it('does not await a runtime Promise-like observer that never settles', async () => {
    const then = jest.fn((): void => undefined)
    const observer = (() => ({ then })) as unknown as OutboundHttpRunnerObserver
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 1,
      deadlineMs: 1_000,
      observer,
    })

    const result = await Promise.race([
      runner.run(
        () => Promise.resolve(responseOutcome),
        () => ({ type: 'succeed' }),
        new AbortController().signal,
      ),
      new Promise<'pending'>((resolve) =>
        setImmediate(() => resolve('pending')),
      ),
    ])

    expect(result).toMatchObject({ type: 'succeeded' })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(then).toHaveBeenCalledTimes(3)
  })

  it('emits no event after run_finished when active work settles late', async () => {
    const pending = deferred<OutboundHttpAttemptOutcome>()
    const outer = new AbortController()
    const events: BoundedOutboundHttpRunnerEvent[] = []
    const runner = new BoundedOutboundHttpRunner({
      maxAttempts: 2,
      deadlineMs: 60_000,
      observer: (event) => events.push(event),
    })
    const running = runner.run(
      () => pending.promise,
      () => ({ type: 'succeed' }),
      outer.signal,
    )
    await Promise.resolve()

    outer.abort()
    await running
    const eventsAtFinish = [...events]

    pending.resolve(responseOutcome)
    await Promise.resolve()
    await Promise.resolve()

    expect(events).toEqual(eventsAtFinish)
    expect(events.at(-1)).toEqual({
      type: 'run_finished',
      result: 'aborted',
      attempts: 1,
    })
  })
})
