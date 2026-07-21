import type { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'

import type { RedisManagedClient } from './redis-capability'

/** Stable failure for a Redis operation that outlived its absolute deadline. */
export class RedisCommandTimeoutError extends Error {
  public constructor() {
    super('Redis command deadline exceeded')
    this.name = 'RedisCommandTimeoutError'
  }
}

/** Runs Redis commands inside operation tracking and an absolute deadline. */
export class RedisCommandExecutor {
  public constructor(
    private readonly client: RedisManagedClient,
    private readonly operationTracker: ActiveOperationTracker,
    private readonly timeoutMs: number,
  ) {}

  /**
   * Executes one operation or destroys its socket when the deadline wins.
   *
   * @remarks Destruction forces settlement but does not claim that Redis
   * cancelled a command already received by the server.
   */
  public async execute<T>(
    operationName: string,
    operation: (client: RedisManagedClient) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    void operationName
    const lease = this.operationTracker.begin()
    try {
      return await this.withDeadline(operation, [lease.signal, signal])
    } finally {
      lease.complete()
    }
  }

  private withDeadline<T>(
    operation: (client: RedisManagedClient) => Promise<T>,
    signals: readonly (AbortSignal | undefined)[],
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        for (const signal of signals)
          signal?.removeEventListener('abort', abort)
        callback()
      }
      const abort = (): void => {
        this.client.destroy()
        finish(() => reject(new RedisCommandTimeoutError()))
      }
      const timer = setTimeout(abort, this.timeoutMs)
      for (const signal of signals) {
        if (signal?.aborted === true) {
          abort()
          return
        }
        signal?.addEventListener('abort', abort, { once: true })
      }
      void operation(this.client).then(
        (value) => finish(() => resolve(value)),
        (error: unknown) =>
          finish(() =>
            reject(
              error instanceof Error
                ? error
                : new Error('Redis command failed without an Error cause'),
            ),
          ),
      )
    })
  }
}
