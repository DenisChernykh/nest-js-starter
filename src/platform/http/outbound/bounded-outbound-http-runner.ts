import type {
  OutboundHttpAttemptOutcome,
  OutboundHttpResponseBody,
} from '@/platform/http/outbound/fetch-outbound-http-attempt-transport'

export interface OutboundHttpAttemptContext {
  readonly attempt: number
  readonly signal: AbortSignal
}

export type OutboundHttpAttempt = (
  context: OutboundHttpAttemptContext,
) => Promise<OutboundHttpAttemptOutcome>

export type OutboundHttpRetryDecision =
  | { readonly type: 'succeed' }
  | { readonly type: 'fail' }
  | { readonly type: 'retry'; readonly nextDelayMs?: number }

export interface OutboundHttpClassifierContext {
  readonly attempt: number
  readonly remainingAttempts: number
  readonly remainingMs: number
}

export type OutboundHttpOutcomeClassifier = (
  outcome: OutboundHttpAttemptOutcome,
  context: OutboundHttpClassifierContext,
) => OutboundHttpRetryDecision

export interface BoundedOutboundHttpRunnerOptions {
  readonly maxAttempts: number
  readonly deadlineMs: number
  readonly observer?: OutboundHttpRunnerObserver
}

export type BoundedOutboundHttpRunnerEvent =
  | {
      readonly type: 'attempt_started'
      readonly attempt: number
      readonly remainingMs: number
    }
  | {
      readonly type: 'attempt_finished'
      readonly attempt: number
      readonly category: OutboundHttpAttemptOutcome['type']
      readonly status?: number
      readonly bodyState?: OutboundHttpResponseBody['type']
      readonly durationMs: number
    }
  | {
      readonly type: 'retry_scheduled'
      readonly attempt: number
      readonly delayMs: number
      readonly remainingMs: number
    }
  | {
      readonly type: 'run_finished'
      readonly result: OutboundHttpRunResult['type']
      readonly attempts: number
      readonly failureReason?: 'terminal' | 'exhausted'
    }

export type OutboundHttpRunnerObserver = (
  event: BoundedOutboundHttpRunnerEvent,
) => void

export type OutboundHttpRunResult =
  | {
      readonly type: 'succeeded'
      readonly outcome: OutboundHttpAttemptOutcome
      readonly attempts: number
    }
  | {
      readonly type: 'failed'
      readonly reason: 'terminal' | 'exhausted'
      readonly outcome: OutboundHttpAttemptOutcome
      readonly attempts: number
    }
  | { readonly type: 'aborted'; readonly attempts: number }
  | { readonly type: 'deadline_exceeded'; readonly attempts: number }

const maximumTimerDelayMs = 2_147_483_647

type RunInterruptionSource = 'aborted' | 'deadline_exceeded'

interface RunInterruption {
  readonly type: 'interrupted'
  readonly source: RunInterruptionSource
}

export class BoundedOutboundHttpRunner {
  private readonly deadlineMs: number
  private readonly maxAttempts: number
  private readonly observer: OutboundHttpRunnerObserver | undefined

  public constructor(options: BoundedOutboundHttpRunnerOptions) {
    assertMaxAttempts(options.maxAttempts)
    assertDeadline(options.deadlineMs)
    this.deadlineMs = options.deadlineMs
    this.maxAttempts = options.maxAttempts
    this.observer = options.observer
  }

  public async run(
    attempt: OutboundHttpAttempt,
    classifier: OutboundHttpOutcomeClassifier,
    signal: AbortSignal,
  ): Promise<OutboundHttpRunResult> {
    const deadline = performance.now() + this.deadlineMs
    let admittedAttempts = 0
    if (signal.aborted) {
      return this.finish({ type: 'aborted', attempts: admittedAttempts })
    }

    let activeController: AbortController | undefined
    let interruptionSource: RunInterruptionSource | undefined
    let resolveInterruption!: (interruption: RunInterruption) => void
    const interruption = new Promise<RunInterruption>((resolve) => {
      resolveInterruption = resolve
    })
    const interrupt = (
      source: RunInterruptionSource,
      reason?: unknown,
    ): void => {
      if (interruptionSource !== undefined) return
      interruptionSource = source
      resolveInterruption({ type: 'interrupted', source })
      activeController?.abort(reason)
    }
    const onAbort = (): void => interrupt('aborted', signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    const deadlineTimer = setTimeout(
      () => interrupt('deadline_exceeded'),
      remainingMilliseconds(deadline),
    )

    const currentInterruption = (): RunInterruptionSource | undefined => {
      if (interruptionSource !== undefined) return interruptionSource
      if (signal.aborted) {
        interrupt('aborted', signal.reason)
        return 'aborted'
      }
      if (remainingMilliseconds(deadline) <= 0) {
        interrupt('deadline_exceeded')
        return 'deadline_exceeded'
      }
      return undefined
    }

    try {
      while (admittedAttempts < this.maxAttempts) {
        const beforeAdmission = currentInterruption()
        if (beforeAdmission !== undefined) {
          return this.finish(
            interruptionResult(beforeAdmission, admittedAttempts),
          )
        }

        admittedAttempts += 1
        const controller = new AbortController()
        activeController = controller
        this.emit({
          type: 'attempt_started',
          attempt: admittedAttempts,
          remainingMs: remainingMilliseconds(deadline),
        })
        const afterAttemptStarted = currentInterruption()
        if (afterAttemptStarted !== undefined) {
          return this.finish(
            interruptionResult(afterAttemptStarted, admittedAttempts),
          )
        }

        const execution = attempt({
          attempt: admittedAttempts,
          signal: controller.signal,
        })
        const afterAttempt = currentInterruption()
        if (afterAttempt !== undefined) {
          void execution.catch(() => undefined)
          return this.finish(interruptionResult(afterAttempt, admittedAttempts))
        }

        const winner = await Promise.race([execution, interruption])
        activeController = undefined

        if (winner.type === 'interrupted') {
          return this.finish(
            interruptionResult(winner.source, admittedAttempts),
          )
        }

        const outcome = winner
        this.emitAttemptFinished(admittedAttempts, outcome)
        const decision = classifier(outcome, {
          attempt: admittedAttempts,
          remainingAttempts: this.maxAttempts - admittedAttempts,
          remainingMs: remainingMilliseconds(deadline),
        })

        let delayMs: number | undefined
        if (decision.type === 'retry') {
          delayMs = decision.nextDelayMs ?? 0
          assertRetryDelay(delayMs)
        }

        if (decision.type === 'succeed') {
          return this.finish({
            type: 'succeeded',
            outcome,
            attempts: admittedAttempts,
          })
        }
        if (decision.type === 'fail') {
          return this.finish({
            type: 'failed',
            reason: 'terminal',
            outcome,
            attempts: admittedAttempts,
          })
        }

        if (admittedAttempts === this.maxAttempts) {
          return this.finish({
            type: 'failed',
            reason: 'exhausted',
            outcome,
            attempts: admittedAttempts,
          })
        }

        const beforeRetry = currentInterruption()
        if (beforeRetry !== undefined) {
          return this.finish(interruptionResult(beforeRetry, admittedAttempts))
        }

        this.emit({
          type: 'retry_scheduled',
          attempt: admittedAttempts,
          delayMs: delayMs ?? 0,
          remainingMs: remainingMilliseconds(deadline),
        })
        const waitResult = await waitForDelay(delayMs ?? 0, interruption)
        if (waitResult !== 'elapsed') {
          return this.finish(
            interruptionResult(waitResult.source, admittedAttempts),
          )
        }
      }
    } finally {
      activeController?.abort()
      clearTimeout(deadlineTimer)
      signal.removeEventListener('abort', onAbort)
    }

    throw new Error('Unreachable outbound HTTP runner state')
  }

  private emitAttemptFinished(
    attempt: number,
    outcome: OutboundHttpAttemptOutcome,
  ): void {
    if (outcome.type === 'response') {
      this.emit({
        type: 'attempt_finished',
        attempt,
        category: outcome.type,
        status: outcome.status,
        bodyState: outcome.body.type,
        durationMs: outcome.durationMs,
      })
      return
    }
    this.emit({
      type: 'attempt_finished',
      attempt,
      category: outcome.type,
      durationMs: outcome.durationMs,
    })
  }

  private finish(result: OutboundHttpRunResult): OutboundHttpRunResult {
    if (result.type === 'failed') {
      this.emit({
        type: 'run_finished',
        result: result.type,
        attempts: result.attempts,
        failureReason: result.reason,
      })
    } else {
      this.emit({
        type: 'run_finished',
        result: result.type,
        attempts: result.attempts,
      })
    }
    return result
  }

  private emit(event: BoundedOutboundHttpRunnerEvent): void {
    if (this.observer === undefined) return
    try {
      const result: unknown = this.observer(event)
      void Promise.resolve(result).catch(() => undefined)
    } catch {
      // Telemetry cannot change result selection or attempt admission.
    }
  }
}

function assertMaxAttempts(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('maxAttempts must be a positive safe integer')
  }
}

function assertDeadline(value: number): void {
  if (!Number.isInteger(value) || value <= 0 || value > maximumTimerDelayMs) {
    throw new RangeError('deadlineMs is outside the supported timer range')
  }
}

function assertRetryDelay(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > maximumTimerDelayMs) {
    throw new RangeError('nextDelayMs is outside the supported timer range')
  }
}

function remainingMilliseconds(deadline: number): number {
  const remaining = deadline - performance.now()
  return Number.isFinite(remaining) && remaining > 0 ? remaining : 0
}

function interruptionResult(
  source: RunInterruptionSource,
  attempts: number,
): OutboundHttpRunResult {
  return source === 'aborted'
    ? { type: 'aborted', attempts }
    : { type: 'deadline_exceeded', attempts }
}

async function waitForDelay(
  delayMs: number,
  interruption: Promise<RunInterruption>,
): Promise<'elapsed' | RunInterruption> {
  if (delayMs === 0) return 'elapsed'
  let timer: ReturnType<typeof setTimeout> | undefined
  const elapsed = new Promise<'elapsed'>((resolve) => {
    timer = setTimeout(() => resolve('elapsed'), delayMs)
  })
  try {
    return await Promise.race([elapsed, interruption])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
