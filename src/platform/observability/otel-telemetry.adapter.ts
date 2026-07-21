import { SpanStatusCode, trace, type Tracer } from '@opentelemetry/api'

import type {
  AuthTelemetryOperation,
  AuthTelemetryOutcome,
  TelemetryPort,
} from '@/shared/application/telemetry.port'

import { RuntimeMetrics } from './runtime-metrics'

type TelemetryDiagnostic = (code: string) => void

const spanNames: Readonly<Record<AuthTelemetryOperation, string>> = {
  login: 'auth.login',
  authenticate: 'auth.authenticate',
  change_password: 'auth.change_password',
  logout_all: 'auth.logout_all',
  revoke_session: 'auth.revoke_session',
}

/** OpenTelemetry adapter that cannot replace an application operation result. */
export class OtelTelemetryAdapter implements TelemetryPort {
  public constructor(
    private readonly tracer: Tracer = trace.getTracer(
      'nest-js-starter.application',
    ),
    private readonly metrics: RuntimeMetrics = new RuntimeMetrics(),
    private readonly diagnostic: TelemetryDiagnostic = () => undefined,
  ) {}

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

  /** Records a finite auth outcome while isolating metric failures. */
  public recordAuthOutcome(
    operation: AuthTelemetryOperation,
    outcome: AuthTelemetryOutcome,
  ): void {
    try {
      this.metrics.recordAuth(operation, outcome)
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
