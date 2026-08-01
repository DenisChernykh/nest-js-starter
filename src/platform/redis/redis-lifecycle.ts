import type { RedisAuthConnectionManager } from './redis-auth.connection'

/** Connects and closes the single Redis auth dependency. */
export class RedisLifecycle {
  private connectPromise?: Promise<void>
  private closePromise?: Promise<void>

  public constructor(
    private readonly connection: RedisAuthConnectionManager,
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
