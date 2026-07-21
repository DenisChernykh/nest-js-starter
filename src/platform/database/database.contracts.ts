/**
 * Explicit startup and cleanup contract for the required database resource.
 */
export interface DatabaseLifecycle {
  /** Opens and verifies the database within the caller and configured deadline. */
  connect(signal: AbortSignal): Promise<void>
  /** Stops admission and closes resources within the caller's remaining budget. */
  close(signal: AbortSignal): Promise<void>
}

/**
 * Required PostgreSQL readiness indicator contract.
 */
export interface DatabaseReadinessProbe {
  readonly name: 'postgresql'
  readonly required: true
  readonly timeoutMs: number
  /** Returns only dependency state and never exposes driver errors or URLs. */
  check(signal: AbortSignal): Promise<'up' | 'down'>
}

/**
 * Safe failure used when database admission or lifecycle work is unavailable.
 */
export class DatabaseUnavailableError extends Error {
  public constructor() {
    super('Database is unavailable')
    this.name = 'DatabaseUnavailableError'
  }
}
