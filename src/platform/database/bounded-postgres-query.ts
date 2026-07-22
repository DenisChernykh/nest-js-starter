import { performance } from 'node:perf_hooks'

import type { Pool, PoolClient, QueryConfig, QueryResult } from 'pg'

interface TimedQueryConfig extends QueryConfig {
  readonly query_timeout: number
}

const interrupted = Symbol('interrupted')

function remainingMilliseconds(deadline: number): number {
  return Math.max(1, Math.ceil(deadline - performance.now()))
}

function interruption(
  signal: AbortSignal,
  milliseconds: number,
): {
  readonly promise: Promise<typeof interrupted>
  readonly dispose: () => void
} {
  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined
  const promise = new Promise<typeof interrupted>((resolve) => {
    const finish = (): void => resolve(interrupted)
    onAbort = finish
    if (signal.aborted) {
      finish()
      return
    }
    signal.addEventListener('abort', finish, { once: true })
    timer = setTimeout(finish, milliseconds)
  })
  return {
    promise,
    dispose: () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      if (onAbort !== undefined) {
        signal.removeEventListener('abort', onAbort)
      }
    },
  }
}

function releaseOnce(client: PoolClient, destroy: boolean): void {
  client.release(destroy)
}

/**
 * Runs one health-only query within one acquisition-plus-query deadline.
 *
 * @remarks Timeout or abort destructively releases an acquired client and
 * observes losing driver promises without awaiting them on the health response
 * path. Business Prisma queries must not use this short health deadline.
 * @param pool - Externally owned PostgreSQL Pool.
 * @param text - Constant health SQL owned by the platform adapter.
 * @param signal - Parent cancellation signal.
 * @param timeoutMs - Total acquisition and query deadline in milliseconds.
 * @returns `up` only after a successful query; every safe failure is `down`.
 */
export async function runBoundedPostgresQuery(
  pool: Pool,
  text: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<'up' | 'down'> {
  const deadline = performance.now() + timeoutMs
  const acquisition = pool.connect()
  const acquireInterruption = interruption(
    signal,
    remainingMilliseconds(deadline),
  )
  let client: PoolClient
  try {
    const acquired = await Promise.race([
      acquisition,
      acquireInterruption.promise,
    ])
    if (acquired === interrupted) {
      void acquisition
        .then((lateClient) => releaseOnce(lateClient, true))
        .catch(() => undefined)
      return 'down'
    }
    client = acquired
  } catch {
    return 'down'
  } finally {
    acquireInterruption.dispose()
  }

  const queryConfig: TimedQueryConfig = {
    text,
    query_timeout: remainingMilliseconds(deadline),
  }
  const query: Promise<QueryResult> = client.query(queryConfig)
  const queryInterruption = interruption(
    signal,
    remainingMilliseconds(deadline),
  )
  try {
    const result = await Promise.race([query, queryInterruption.promise])
    if (result === interrupted) {
      releaseOnce(client, true)
      void query.catch(() => undefined)
      return 'down'
    }
    releaseOnce(client, false)
    return 'up'
  } catch {
    releaseOnce(client, true)
    return 'down'
  } finally {
    queryInterruption.dispose()
  }
}
