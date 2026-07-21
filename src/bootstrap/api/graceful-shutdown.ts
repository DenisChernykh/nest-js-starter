import type { ApiRuntime } from './api-runtime'

/** Exit decision produced after bounded graceful cleanup. */
export interface GracefulShutdownResult {
  readonly exitCode: 0 | 1
  readonly forced: boolean
}

function deadlineSignal(milliseconds: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, milliseconds))
}

/** Coordinates one bounded drain, operation abort and ordered cleanup. */
export class GracefulShutdownCoordinator {
  private shutdownPromise: Promise<GracefulShutdownResult> | undefined

  public constructor(private readonly runtime: ApiRuntime) {}

  /** Runs or shares the single shutdown sequence. */
  public shutdown(reason: string): Promise<GracefulShutdownResult> {
    void reason
    this.shutdownPromise ??= this.shutdownInternal()
    return this.shutdownPromise
  }

  private async shutdownInternal(): Promise<GracefulShutdownResult> {
    this.runtime.cancelStartup()
    const resources = this.runtime.currentResources
    const httpBudget = resources?.httpDrainTimeoutMs ?? 6_000
    const overallBudget = resources?.shutdownGraceMs ?? 10_000
    let failed = false
    let forced = false

    await resources?.application.closeListener?.().catch(() => {
      failed = true
    })
    resources?.application.closeIdleConnections?.()
    const httpSignal = deadlineSignal(httpBudget)
    const [requestsIdle, operationsIdle] = await Promise.all([
      resources?.requestTracker?.waitForIdle(httpSignal) ??
        Promise.resolve(true),
      resources?.operationTracker?.waitForIdle(httpSignal) ??
        Promise.resolve(true),
    ])
    if (!requestsIdle || !operationsIdle) {
      forced = true
      failed = true
      resources?.operationTracker?.abortAll()
      resources?.application.closeAllConnections?.()
    }
    const cleanupSignal = deadlineSignal(
      Math.max(1, overallBudget - httpBudget),
    )
    if (resources?.operationTracker !== undefined) {
      const settled =
        await resources.operationTracker.waitForIdle(cleanupSignal)
      if (!settled) failed = true
    }
    if (resources?.shutdownRegistry !== undefined) {
      const result = await resources.shutdownRegistry.closeAll(cleanupSignal)
      if (result.failed.length > 0 || result.timedOut) failed = true
    } else {
      await resources?.database.close(cleanupSignal).catch(() => {
        failed = true
      })
    }
    await resources?.application.close().catch(() => {
      failed = true
    })
    return { exitCode: failed ? 1 : 0, forced }
  }
}
