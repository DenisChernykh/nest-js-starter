import {
  SpanKind,
  SpanStatusCode,
  trace,
  type Tracer,
} from '@opentelemetry/api'

import type { RedisManagedClient } from './redis-client.factory'

/** Stable failure for a Redis operation that outlived its absolute deadline. */
export class RedisCommandTimeoutError extends Error {
  public constructor() {
    super('Redis command deadline exceeded')
    this.name = 'RedisCommandTimeoutError'
  }
}

/** Narrow command boundary exposed to module-owned Redis adapters. */
export interface RedisCommandExecutorPort {
  /** Executes one bounded command through the owned coordination client. */
  execute<T>(
    operationName: string,
    operation: (client: RedisManagedClient) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>
}

/** Runs coordination Redis commands with tracing and absolute deadlines. */
export class RedisCommandExecutor implements RedisCommandExecutorPort {
  public constructor(
    private readonly client: RedisManagedClient,
    private readonly timeoutMs: number,
    private readonly tracer: Tracer = trace.getTracer(
      'nest-js-starter.redis-runtime',
    ),
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
    const command = redisCommand(operationName)
    return this.runCommandSpan(command, () =>
      this.withDeadline(operation, [signal]),
    )
  }

  private async runCommandSpan<T>(
    command: string,
    work: () => Promise<T>,
  ): Promise<T> {
    let callbackStarted = false
    try {
      return await this.tracer.startActiveSpan(
        'redis.command',
        {
          kind: SpanKind.CLIENT,
          attributes: {
            'db.system.name': 'redis',
            'db.operation.name': command,
            'db.query.text': command,
          },
        },
        async (span) => {
          callbackStarted = true
          try {
            return await work()
          } catch (error: unknown) {
            try {
              span.setStatus({ code: SpanStatusCode.ERROR })
            } catch {
              // Span mutation cannot replace the Redis command rejection.
            }
            throw error
          } finally {
            try {
              span.end()
            } catch {
              // Span export cannot replace the Redis command settlement.
            }
          }
        },
      )
    } catch (error: unknown) {
      if (callbackStarted) throw error
      return work()
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
        try {
          this.client.destroy()
        } catch {
          // A concurrent close may already own the socket transition.
        }
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

function redisCommand(operationName: string): string {
  if (operationName.startsWith('script-load:')) return 'SCRIPT'
  if (operationName.startsWith('script:')) return 'EVALSHA'
  const commands: Readonly<Record<string, string>> = {
    'readiness-ping': 'PING',
    ping: 'PING',
    'session-list-record': 'GET',
    'session-revoke-lookup': 'HGET',
    'session-owner-read': 'GET',
    'session-delete-invalid': 'DEL',
    'session-index-public-ids': 'HKEYS',
    'session-index-digests': 'HMGET',
  }
  return commands[operationName] ?? 'OTHER'
}
