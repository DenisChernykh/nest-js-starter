/** Minimal application-context lifecycle owned by a standalone worker. */
export interface WorkerApplication {
  close(): Promise<void>
}

/** Waits for one worker termination signal before closing the application. */
export type WorkerTerminationWaiter = (
  close: () => Promise<void>,
) => Promise<void>

/**
 * Input required to run one bounded standalone worker application.
 *
 * @remarks The process owner injects the final exit policy. The lifecycle
 * helper never calls `process.exit()` directly.
 */
export interface RunWorkerApplicationInput {
  readonly application: WorkerApplication
  readonly shutdownGraceMs: number
  readonly onStarted: () => void
  readonly forceExit: (code: number) => void
  readonly waitForTermination?: WorkerTerminationWaiter
}

function closeWithDeadline(
  close: () => Promise<void>,
  shutdownGraceMs: number,
  forceExit: (code: number) => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      forceExit(1)
      reject(new Error('Worker application close exceeded shutdown grace'))
    }, shutdownGraceMs)
  })
  const closing = Promise.resolve().then(close)
  return Promise.race([closing, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/**
 * Waits for the first SIGINT or SIGTERM and then closes the worker.
 *
 * @param close - Latched application close operation.
 * @returns A promise settled after the first signal's close operation.
 */
export function waitForWorkerTermination(
  close: () => Promise<void>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let signalAccepted = false
    const cleanup = (): void => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
    }
    const onSignal = (): void => {
      if (signalAccepted) return
      signalAccepted = true
      Promise.resolve().then(close).then(resolve, reject).finally(cleanup)
    }

    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
  })
}

/**
 * Runs one worker application and owns only its bounded context shutdown.
 *
 * @param input - Worker context, startup callback and termination policy.
 * @returns A promise settled after worker shutdown.
 * @throws The original startup/waiter error, or a close failure/timeout.
 */
export async function runWorkerApplication(
  input: RunWorkerApplicationInput,
): Promise<void> {
  let closePromise: Promise<void> | undefined
  const closeOnce = (): Promise<void> => {
    closePromise ??= closeWithDeadline(
      () => input.application.close(),
      input.shutdownGraceMs,
      input.forceExit,
    )
    return closePromise
  }
  const waitForTermination =
    input.waitForTermination ?? waitForWorkerTermination

  try {
    input.onStarted()
    await waitForTermination(closeOnce)
  } catch (error: unknown) {
    await closeOnce().catch(() => undefined)
    throw error
  }
}
