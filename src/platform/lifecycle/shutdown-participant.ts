/** One ordered cooperative shutdown participant. */
export interface ShutdownParticipant {
  readonly name: string
  readonly order: number
  /** Closes owned resources and settles explicitly after abort. */
  close(signal: AbortSignal): Promise<void>
}

/** Stable aggregate result of ordered participant cleanup. */
export interface ShutdownResult {
  readonly completed: readonly string[]
  readonly failed: readonly string[]
  readonly timedOut: boolean
}

/** Reserved shutdown order for PostgreSQL resources. */
export const DATABASE_SHUTDOWN_ORDER = 300
