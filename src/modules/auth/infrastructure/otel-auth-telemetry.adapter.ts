import {
  metrics,
  SpanStatusCode,
  trace,
  type Counter,
  type Meter,
  type Tracer,
} from '@opentelemetry/api'

import type {
  AuthTelemetryOperation,
  AuthTelemetryOutcome,
  AuthTelemetryPort,
} from '../application/auth-telemetry.port'

type TelemetryDiagnostic = (code: string) => void

const spanNames: Readonly<Record<AuthTelemetryOperation, string>> = {
  login: 'auth.login',
  authenticate: 'auth.authenticate',
  change_password: 'auth.change_password',
  logout_all: 'auth.logout_all',
  revoke_session: 'auth.revoke_session',
}
const authOperations = new Set<AuthTelemetryOperation>([
  'login',
  'authenticate',
  'change_password',
  'logout_all',
  'revoke_session',
])
const authOutcomes = new Set<AuthTelemetryOutcome>([
  'success',
  'denied',
  'rate_limited',
  'conflict',
  'partial',
  'dependency_error',
])

/** OpenTelemetry adapter owned by auth that preserves application settlement. */
export class OtelAuthTelemetryAdapter implements AuthTelemetryPort {
  private readonly tracer: Tracer
  private readonly authOperations?: Counter

  public constructor(
    tracer: Tracer = trace.getTracer('nest-js-starter.auth'),
    meter: Meter = metrics.getMeter('nest-js-starter.auth'),
    private readonly diagnostic: TelemetryDiagnostic = () => undefined,
  ) {
    this.tracer = tracer
    try {
      this.authOperations = meter.createCounter('auth.operation.count')
    } catch {
      this.report('auth_metric_create_failed')
    }
  }

  /** Runs work once in a fixed auth span and preserves its exact settlement. */
  public async runAuthOperation<T>(
    operation: AuthTelemetryOperation,
    work: () => Promise<T>,
  ): Promise<T> {
    let callbackStarted = false
    try {
      return await this.tracer.startActiveSpan(
        spanNames[operation],
        async (span) => {
          callbackStarted = true
          try {
            return await work()
          } catch (error: unknown) {
            this.safeSpanCall(() =>
              span.setStatus({ code: SpanStatusCode.ERROR }),
            )
            throw error
          } finally {
            this.safeSpanCall(() => span.end())
          }
        },
      )
    } catch (error: unknown) {
      if (callbackStarted) throw error
      this.report('auth_span_start_failed')
      return work()
    }
  }

  /** Records a finite auth outcome while isolating instrument failures. */
  public recordAuthOutcome(
    operation: AuthTelemetryOperation,
    outcome: AuthTelemetryOutcome,
  ): void {
    if (!authOperations.has(operation) || !authOutcomes.has(outcome)) {
      throw new Error('Invalid auth metric')
    }
    try {
      this.authOperations?.add(1, { operation, outcome })
    } catch {
      this.report('auth_metric_emit_failed')
    }
  }

  private safeSpanCall(work: () => void): void {
    try {
      work()
    } catch {
      this.report('auth_span_update_failed')
    }
  }

  private report(code: string): void {
    try {
      this.diagnostic(code)
    } catch {
      // Diagnostic output cannot replace the application result.
    }
  }
}
