import { Injectable } from '@nestjs/common'

import type { HealthCheckResult, HealthIndicatorStatus } from './health.types'
import type { ReadinessIndicator } from './readiness-indicator'

function stableRecord<T>(
  entries: readonly (readonly [string, T])[],
): Record<string, T> {
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => left.localeCompare(right)),
  )
}

/** Executes the fixed PostgreSQL and Redis readiness probe set. */
@Injectable()
export class HealthRegistry {
  private readonly indicators: readonly ReadinessIndicator[]

  public constructor(indicators: readonly ReadinessIndicator[] = []) {
    const names = new Set<string>()
    for (const indicator of indicators) {
      if (
        names.has(indicator.name) ||
        indicator.name === 'draining' ||
        indicator.name === 'startup'
      ) {
        throw new Error('Health indicator configuration rejected')
      }
      names.add(indicator.name)
    }
    this.indicators = Object.freeze([...indicators])
  }

  /** Returns stable skipped statuses without starting dependency work. */
  public skippedChecks(): Readonly<Record<string, HealthIndicatorStatus>> {
    return stableRecord(
      this.indicators.map(({ name }) => [name, 'skipped'] as const),
    )
  }

  /** Runs the fixed indicators concurrently within their individual deadlines. */
  public async checkAll(parentSignal: AbortSignal): Promise<HealthCheckResult> {
    const results = await Promise.all(
      this.indicators.map(async (indicator) => ({
        indicator,
        status: await this.checkOne(indicator, parentSignal),
      })),
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
    if (parentSignal.aborted) child.abort()
    else parentSignal.addEventListener('abort', abortChild, { once: true })
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
    const checking = Promise.resolve(indicator.check(child.signal)).catch(
      () => 'down' as const,
    )
    try {
      return await Promise.race([checking, aborted])
    } finally {
      clearTimeout(timeout)
      parentSignal.removeEventListener('abort', abortChild)
    }
  }
}
