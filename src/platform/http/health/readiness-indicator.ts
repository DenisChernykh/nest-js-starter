/** Readiness dependency contract with an owned absolute timeout. */
export interface ReadinessIndicator {
  readonly name: string
  readonly required: boolean
  readonly timeoutMs: number
  /** Checks dependency state and settles after cleaning up on abort. */
  check(signal: AbortSignal): Promise<'up' | 'down'>
}
