/** One ordered resource opened during process startup and reversible on failure. */
export interface StartupParticipant {
  readonly name: string
  readonly order: number
  /** Opens and verifies the owned resource within the caller's signal. */
  start(signal: AbortSignal): Promise<void>
  /** Closes the resource after successful start or later process shutdown. */
  stop(signal: AbortSignal): Promise<void>
}
