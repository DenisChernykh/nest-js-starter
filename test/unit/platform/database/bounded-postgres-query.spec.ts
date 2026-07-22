import type { Pool, PoolClient, QueryResult } from 'pg'

import { runBoundedPostgresQuery } from '@/platform/database/bounded-postgres-query'

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

async function statusWithin(
  promise: Promise<'up' | 'down'>,
  milliseconds = 25,
): Promise<'up' | 'down' | 'pending'> {
  return Promise.race([
    promise,
    new Promise<'pending'>((resolve) =>
      setTimeout(() => resolve('pending'), milliseconds),
    ),
  ])
}

describe('runBoundedPostgresQuery', () => {
  it('returns on acquisition abort and destroys a client acquired later', async () => {
    const acquisition = deferred<PoolClient>()
    const release = jest.fn()
    const client = { release } as unknown as PoolClient
    const pool = {
      connect: jest.fn(() => acquisition.promise),
    } as unknown as Pool
    const controller = new AbortController()

    const probing = runBoundedPostgresQuery(
      pool,
      'SELECT 1',
      controller.signal,
      10_000,
    )
    controller.abort()
    const status = await statusWithin(probing)
    acquisition.resolve(client)
    await probing
    await Promise.resolve()

    expect(status).toBe('down')
    expect(release).toHaveBeenCalledWith(true)
  })

  it('returns on query abort without awaiting a stuck driver promise', async () => {
    const query = deferred<QueryResult>()
    const release = jest.fn()
    const client = {
      query: jest.fn(() => query.promise),
      release,
    } as unknown as PoolClient
    const pool = {
      connect: jest.fn(() => Promise.resolve(client)),
    } as unknown as Pool
    const controller = new AbortController()

    const probing = runBoundedPostgresQuery(
      pool,
      'SELECT 1',
      controller.signal,
      10_000,
    )
    await Promise.resolve()
    controller.abort()
    const status = await statusWithin(probing)
    query.reject(new Error('late driver rejection'))
    await probing

    expect(status).toBe('down')
    expect(release).toHaveBeenCalledWith(true)
  })
})
