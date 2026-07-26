import type { RedisCoordinationConnectionManager } from './redis-coordination.connection'

/** Connects and closes the single Redis coordination dependency. */
export class RedisLifecycle {
  private connectPromise?: Promise<void>
  private closePromise?: Promise<void>

  public constructor(
    private readonly connection: RedisCoordinationConnectionManager,
    private readonly shutdownTimeoutMs: number,
  ) {}

  /** Starts all required Redis capabilities once. */
  public connect(signal: AbortSignal): Promise<void> {
    this.connectPromise ??= this.connection.connect(signal)
    return this.connectPromise
  }

  /** Closes all opened Redis capabilities once. */
  public close(signal: AbortSignal): Promise<void> {
    this.closePromise ??= this.connection.close(
      AbortSignal.any([signal, AbortSignal.timeout(this.shutdownTimeoutMs)]),
    )
    return this.closePromise
  }
}
