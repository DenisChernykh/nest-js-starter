import { Injectable } from '@nestjs/common'

import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'

import { HealthRegistry } from './health-registry'
import type {
  HealthHttpResult,
  HealthIndicatorStatus,
  LivenessSnapshot,
  ReadinessSnapshot,
  StartupSnapshot,
} from './health.types'

function stableChecks(
  entries: Readonly<Record<string, HealthIndicatorStatus>>,
): Readonly<Record<string, HealthIndicatorStatus>> {
  return Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  )
}

/** Computes lifecycle-aware health snapshots without transport concerns. */
@Injectable()
export class HealthService {
  public constructor(
    private readonly lifecycle: ApplicationLifecycleState,
    private readonly registry: HealthRegistry,
  ) {}

  /** Returns process liveness without calling dependencies. */
  public live(): HealthHttpResult<LivenessSnapshot> {
    return { statusCode: 200, body: { status: 'ok' } }
  }

  /** Returns the irreversible startup latch contract. */
  public startup(): HealthHttpResult<StartupSnapshot> {
    if (this.lifecycle.startupComplete) {
      return { statusCode: 200, body: { status: 'ok' } }
    }
    return {
      statusCode: 503,
      body: {
        status:
          this.lifecycle.phase === 'starting' ? 'starting' : 'unavailable',
      },
    }
  }

  /** Returns readiness after checking lifecycle both before and after probes. */
  public async ready(
    signal: AbortSignal,
  ): Promise<HealthHttpResult<ReadinessSnapshot>> {
    if (this.lifecycle.phase !== 'ready') {
      return this.unavailableWithoutChecks()
    }
    const result = await this.registry.checkAll(signal)
    if (this.lifecycle.phase !== 'ready') {
      return this.unavailableWithoutChecks()
    }
    const checks = stableChecks({
      ...result.checks,
      draining: 'up',
      startup: 'up',
    })
    return result.requiredAvailable
      ? { statusCode: 200, body: { status: 'ok', checks } }
      : { statusCode: 503, body: { status: 'unavailable', checks } }
  }

  private unavailableWithoutChecks(): HealthHttpResult<ReadinessSnapshot> {
    return {
      statusCode: 503,
      body: {
        status: 'unavailable',
        checks: stableChecks({
          ...this.registry.skippedChecks(),
          draining: this.lifecycle.phase === 'draining' ? 'down' : 'up',
          startup: this.lifecycle.startupComplete ? 'up' : 'down',
        }),
      },
    }
  }
}
