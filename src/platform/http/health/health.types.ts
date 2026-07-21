/** Stable status of one readiness check. */
export type HealthIndicatorStatus = 'up' | 'down' | 'skipped'

/** Public readiness response body. */
export interface ReadinessSnapshot {
  readonly status: 'ok' | 'unavailable'
  readonly checks: Readonly<Record<string, HealthIndicatorStatus>>
}

/** Public liveness response body. */
export interface LivenessSnapshot {
  readonly status: 'ok'
}

/** Public startup-latch response body. */
export interface StartupSnapshot {
  readonly status: 'ok' | 'starting' | 'unavailable'
}

/** Explicit HTTP status and body returned by the health service. */
export interface HealthHttpResult<T> {
  readonly statusCode: 200 | 503
  readonly body: T
}

/** Internal aggregate of registered dependency checks. */
export interface HealthCheckResult {
  readonly checks: Readonly<Record<string, 'up' | 'down'>>
  readonly requiredAvailable: boolean
}
