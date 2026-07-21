import { Injectable } from '@nestjs/common'

/** Lease for one handler operation and its cooperative signal. */
export interface ActiveOperationLease {
  readonly signal: AbortSignal
  /** Aborts cooperative work without claiming handler settlement. */
  abort(): void
  /** Removes the operation exactly once after handler settlement. */
  complete(): void
}

/** Tracks handler settlement independently from response transport. */
@Injectable()
export class ActiveOperationTracker {
  private readonly controllers = new Set<AbortController>()
  private readonly idleWaiters = new Set<() => void>()

  /** Returns the current unsettled handler count. */
  public get activeCount(): number {
    return this.controllers.size
  }

  /** Begins one operation lease. */
  public begin(): ActiveOperationLease {
    const controller = new AbortController()
    this.controllers.add(controller)
    let completed = false
    return {
      signal: controller.signal,
      abort: () => controller.abort(),
      complete: () => {
        if (completed) return
        completed = true
        this.controllers.delete(controller)
        if (this.controllers.size === 0) {
          for (const resolve of this.idleWaiters) resolve()
          this.idleWaiters.clear()
        }
      },
    }
  }

  /** Aborts every active cooperative signal without claiming settlement. */
  public abortAll(): void {
    for (const controller of this.controllers) controller.abort()
  }

  /** Resolves true at idle or false when the shared signal aborts first. */
  public waitForIdle(signal: AbortSignal): Promise<boolean> {
    if (this.controllers.size === 0) return Promise.resolve(true)
    if (signal.aborted) return Promise.resolve(false)
    return new Promise((resolve) => {
      const idle = (): void => {
        signal.removeEventListener('abort', aborted)
        resolve(true)
      }
      const aborted = (): void => {
        this.idleWaiters.delete(idle)
        resolve(false)
      }
      this.idleWaiters.add(idle)
      signal.addEventListener('abort', aborted, { once: true })
    })
  }
}
