import type { ApiRuntime } from './api-runtime'

/** Exit decision produced after bounded graceful cleanup. */
export interface GracefulShutdownResult {
  readonly exitCode: 0 | 1
  readonly forced: boolean
}

function deadlineSignal(milliseconds: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, milliseconds))
}

/** Coordinates one bounded drain and explicit Redis, database, OTel cleanup. */
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
    const requestsIdle = await (resources?.requestTracker?.waitForIdle(
      httpSignal,
    ) ?? Promise.resolve(true))
    if (!requestsIdle) {
      forced = true
      failed = true
      resources?.application.closeAllConnections?.()
    }
    const cleanupSignal = deadlineSignal(
      Math.max(1, overallBudget - httpBudget),
    )
    await resources?.redis.close(cleanupSignal).catch(() => {
      failed = true
    })
    await resources?.database.close(cleanupSignal).catch(() => {
      failed = true
    })
    await resources?.observability?.close(cleanupSignal).catch(() => {
      failed = true
    })
    await resources?.application.close().catch(() => {
      failed = true
    })
    return { exitCode: failed ? 1 : 0, forced }
  }
}
