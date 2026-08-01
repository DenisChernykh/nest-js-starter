import type { ReadinessIndicator } from '@/platform/http/health/readiness-indicator'

/** Minimal queue client contract needed for a bounded readiness check. */
export interface QueueReadinessClient {
  waitUntilReady(): Promise<unknown>
}

/** Required readiness indicator for the opt-in Redis queue capability. */
export class QueueReadinessIndicator implements ReadinessIndicator {
  public readonly name = 'redis-queue' as const
  public readonly required = true as const

  public constructor(
    private readonly client: QueueReadinessClient,
    public readonly timeoutMs: number,
  ) {}

  /**
   * Waits for queue readiness without creating or closing the queue client.
   *
   * @param signal - Caller-owned abort signal for the readiness operation.
   * @returns `up` after readiness, otherwise redacted `down`.
   */
  public async check(signal: AbortSignal): Promise<'up' | 'down'> {
    if (signal.aborted) return 'down'

    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    try {
      const aborted = new Promise<never>((_, reject) => {
        onAbort = (): void => reject(new Error('queue readiness aborted'))
        signal.addEventListener('abort', onAbort, { once: true })
      })
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('queue readiness timed out')),
          this.timeoutMs,
        )
      })

      await Promise.race([this.client.waitUntilReady(), aborted, timedOut])
      return 'up'
    } catch {
      return 'down'
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (onAbort !== undefined) {
        signal.removeEventListener('abort', onAbort)
      }
    }
  }
}
