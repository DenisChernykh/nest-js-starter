import { performance } from 'node:perf_hooks'

import { Injectable } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { PrismaClient } from '@/generated/prisma/client'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'

import { runBoundedPostgresQuery } from './bounded-postgres-query'
import { DatabaseUnavailableError } from './database.contracts'

type DatabaseState = 'idle' | 'connecting' | 'connected' | 'closing' | 'closed'

const interrupted = Symbol('interrupted')

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

async function waitForSettledWithin<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  milliseconds: number,
): Promise<T> {
  const boundary = interruption(signal, Math.max(1, milliseconds))
  try {
    const result = await Promise.race([promise, boundary.promise])
    if (result === interrupted) {
      await promise.catch(() => undefined)
      throw new DatabaseUnavailableError()
    }
    return result
  } finally {
    boundary.dispose()
  }
}

/**
 * Owns the single external Pool, Prisma adapter and generated Client.
 *
 * @remarks Construction performs no network work. `withClient` closes
 * admission synchronously when shutdown starts and tracks settlement without
 * claiming that Prisma operations can be cancelled by AbortSignal.
 */
@Injectable()
export class PrismaClientProvider {
  private readonly pool: Pool
  private readonly prisma: PrismaClient
  private readonly connectionTimeoutMs: number
  private state: DatabaseState = 'idle'
  private admissionOpen = false
  private degraded = false
  private connectPromise: Promise<void> | undefined
  private closePromise: Promise<void> | undefined
  private cleanupPromise: Promise<void> | undefined
  private readonly activeOperations = new Set<Promise<unknown>>()
  private errorListenerInstalled = true
  private readonly poolErrorHandler = (): void => {
    this.degraded = true
  }

  public constructor(config: RuntimeConfigService) {
    this.connectionTimeoutMs = config.database.connectionTimeoutMs
    this.pool = new Pool({
      connectionString: config.database.url,
      max: config.database.poolMax,
      connectionTimeoutMillis: config.database.connectionTimeoutMs,
      idleTimeoutMillis: config.database.idleTimeoutMs,
    })
    this.pool.on('error', this.poolErrorHandler)
    const adapter = new PrismaPg(this.pool, {
      disposeExternalPool: false,
    })
    this.prisma = new PrismaClient({ adapter })
  }

  /** Opens Prisma and verifies PostgreSQL within one absolute deadline. */
  public connect(signal: AbortSignal): Promise<void> {
    if (this.state === 'connected') {
      return Promise.resolve()
    }
    if (this.state === 'connecting' && this.connectPromise !== undefined) {
      return this.connectPromise
    }
    if (this.state !== 'idle') {
      return Promise.reject(new DatabaseUnavailableError())
    }

    this.state = 'connecting'
    const attempt = this.performConnect(signal)
    this.connectPromise = attempt
    return attempt
  }

  private async performConnect(signal: AbortSignal): Promise<void> {
    const deadline = performance.now() + this.connectionTimeoutMs
    try {
      await waitForSettledWithin(
        this.prisma.$connect(),
        signal,
        deadline - performance.now(),
      )
      if (this.state !== 'connecting') {
        throw new DatabaseUnavailableError()
      }
      const status = await this.runReadinessQuery(
        'SELECT 1',
        signal,
        Math.max(1, deadline - performance.now()),
      )
      if (status !== 'up' || this.state !== 'connecting') {
        throw new DatabaseUnavailableError()
      }
      this.state = 'connected'
      this.admissionOpen = true
      this.degraded = false
    } catch {
      await this.cleanupResources().catch(() => undefined)
      this.state = 'closed'
      throw new DatabaseUnavailableError()
    }
  }

  /** Runs one destructively cancellable raw readiness query. */
  public async runReadinessQuery(
    text: string,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<'up' | 'down'> {
    if (this.state !== 'connecting' && this.state !== 'connected') {
      return 'down'
    }
    const status = await runBoundedPostgresQuery(
      this.pool,
      text,
      signal,
      timeoutMs,
    )
    this.degraded = status !== 'up'
    return status
  }

  /** Checks current PostgreSQL readiness without exposing failure details. */
  public checkReadiness(
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<'up' | 'down'> {
    if (this.state !== 'connected') {
      return Promise.resolve('down')
    }
    return this.runReadinessQuery('SELECT 1', signal, timeoutMs)
  }

  /**
   * Admits and tracks one infrastructure operation while connected.
   *
   * @param operation - Callback invoked immediately with the owned Prisma Client.
   * @returns The callback result after settlement.
   * @throws DatabaseUnavailableError before callback invocation when admission is closed.
   */
  public withClient<T>(
    operation: (client: PrismaClient) => Promise<T>,
  ): Promise<T> {
    if (this.state !== 'connected' || !this.admissionOpen) {
      return Promise.reject(new DatabaseUnavailableError())
    }
    let result: Promise<T>
    try {
      result = Promise.resolve(operation(this.prisma))
    } catch (error: unknown) {
      result = Promise.reject(
        error instanceof Error ? error : new Error('Database operation failed'),
      )
    }
    this.activeOperations.add(result)
    void result.then(
      () => this.activeOperations.delete(result),
      () => this.activeOperations.delete(result),
    )
    return result
  }

  /** Stops admission, waits admitted work and closes Prisma then Pool. */
  public close(signal: AbortSignal): Promise<void> {
    if (this.state === 'closed') {
      return Promise.resolve()
    }
    if (this.closePromise !== undefined) {
      return this.closePromise
    }
    this.admissionOpen = false
    this.state = 'closing'
    const closing = this.performClose(signal).catch((error: unknown) => {
      this.closePromise = undefined
      throw error
    })
    this.closePromise = closing
    return closing
  }

  private async performClose(signal: AbortSignal): Promise<void> {
    if (this.connectPromise !== undefined) {
      await this.connectPromise.catch(() => undefined)
    }
    await this.waitForActiveOperations(signal)
    await this.cleanupResources()
    this.state = 'closed'
  }

  private async waitForActiveOperations(signal: AbortSignal): Promise<void> {
    while (this.activeOperations.size > 0) {
      const boundary = interruption(signal, 86_400_000)
      try {
        const settlement = Promise.allSettled([...this.activeOperations])
        if (
          (await Promise.race([settlement, boundary.promise])) === interrupted
        ) {
          throw new DatabaseUnavailableError()
        }
      } finally {
        boundary.dispose()
      }
    }
  }

  private cleanupResources(): Promise<void> {
    if (this.cleanupPromise !== undefined) {
      return this.cleanupPromise
    }
    this.cleanupPromise = this.performCleanup()
    return this.cleanupPromise
  }

  private async performCleanup(): Promise<void> {
    const failures: unknown[] = []
    try {
      await this.prisma.$disconnect()
    } catch (error: unknown) {
      failures.push(error)
    } finally {
      if (this.errorListenerInstalled) {
        this.pool.off('error', this.poolErrorHandler)
        this.errorListenerInstalled = false
      }
      try {
        await this.pool.end()
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Database cleanup failed')
    }
  }
}
