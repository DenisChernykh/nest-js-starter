import { Injectable } from '@nestjs/common'

import type { HealthCheckResult, HealthIndicatorStatus } from './health.types'
import type { ReadinessIndicator } from './readiness-indicator'

const reservedNames = new Set(['draining', 'startup'])

function stableRecord<T>(
  entries: readonly (readonly [string, T])[],
): Record<string, T> {
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => left.localeCompare(right)),
  )
}

/** Registers readiness indicators once and executes sealed snapshots. */
@Injectable()
export class HealthRegistry {
  private readonly indicators = new Map<string, ReadinessIndicator>()
  private sealed = false

  /** Registers one uniquely named non-reserved indicator before sealing. */
  public register(indicator: ReadinessIndicator): void {
    if (
      this.sealed ||
      reservedNames.has(indicator.name) ||
      this.indicators.has(indicator.name)
    ) {
      throw new Error('Health indicator registration rejected')
    }
    this.indicators.set(indicator.name, indicator)
  }

  /** Permanently closes registration. */
  public seal(): void {
    this.sealed = true
  }

  /** Returns stable skipped statuses without starting dependency work. */
  public skippedChecks(): Readonly<Record<string, HealthIndicatorStatus>> {
    return stableRecord(
      [...this.indicators.keys()].map((name) => [name, 'skipped'] as const),
    )
  }

  /** Runs sealed indicators concurrently without awaiting late timed-out work. */
  public async checkAll(parentSignal: AbortSignal): Promise<HealthCheckResult> {
    if (!this.sealed) {
      throw new Error('Health registry is not sealed')
    }
    const results = await Promise.all(
      [...this.indicators.values()].map(async (indicator) => {
        const status = await this.checkOne(indicator, parentSignal)
        return { indicator, status }
      }),
    )
    return {
      checks: stableRecord(
        results.map(
          ({ indicator, status }) => [indicator.name, status] as const,
        ),
      ),
      requiredAvailable: results.every(
        ({ indicator, status }) => !indicator.required || status === 'up',
      ),
    }
  }

  private async checkOne(
    indicator: ReadinessIndicator,
    parentSignal: AbortSignal,
  ): Promise<'up' | 'down'> {
    const child = new AbortController()
    const abortChild = (): void => child.abort()
    if (parentSignal.aborted) {
      child.abort()
    } else {
      parentSignal.addEventListener('abort', abortChild, { once: true })
    }
    const timeout = setTimeout(abortChild, indicator.timeoutMs)
    const aborted = new Promise<'down'>((resolve) => {
      if (child.signal.aborted) {
        resolve('down')
        return
      }
      child.signal.addEventListener('abort', () => resolve('down'), {
        once: true,
      })
    })
    let checking: Promise<'up' | 'down'>
    try {
      checking = Promise.resolve(indicator.check(child.signal)).catch(
        () => 'down' as const,
      )
    } catch {
      checking = Promise.resolve('down')
    }
    try {
      return await Promise.race([checking, aborted])
    } finally {
      clearTimeout(timeout)
      parentSignal.removeEventListener('abort', abortChild)
    }
  }
}
