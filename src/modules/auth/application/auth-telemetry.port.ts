/** Fixed authentication operations allowed in spans and metric attributes. */
export type AuthTelemetryOperation =
  'login' | 'authenticate' | 'change_password' | 'logout_all' | 'revoke_session'

/** Finite authentication outcomes allowed in metric attributes. */
export type AuthTelemetryOutcome =
  | 'success'
  | 'denied'
  | 'rate_limited'
  | 'conflict'
  | 'partial'
  | 'dependency_error'

/** Framework-free telemetry effects owned by authentication use cases. */
export interface AuthTelemetryPort {
  /** Runs one auth operation inside its fixed telemetry span. */
  runAuthOperation<T>(
    operation: AuthTelemetryOperation,
    work: () => Promise<T>,
  ): Promise<T>

  /** Records one finite auth operation outcome without identifiers. */
  recordAuthOutcome(
    operation: AuthTelemetryOperation,
    outcome: AuthTelemetryOutcome,
  ): void
}

/** Injection token for the module-local authentication telemetry port. */
export const AUTH_TELEMETRY_PORT = Symbol('AUTH_TELEMETRY_PORT')

/** No-op telemetry used by isolated authentication application tests. */
export const NOOP_AUTH_TELEMETRY: AuthTelemetryPort = Object.freeze({
  runAuthOperation: <T>(
    _operation: AuthTelemetryOperation,
    work: () => Promise<T>,
  ): Promise<T> => work(),
  recordAuthOutcome: () => undefined,
})
