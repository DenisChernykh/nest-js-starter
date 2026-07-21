import type { ShutdownParticipant } from '@/platform/lifecycle/shutdown-participant'

import type { RedisConnectionRegistry } from './redis-connection.registry'

/** Reserved shutdown order for Redis resources. */
export const REDIS_SHUTDOWN_ORDER = 200

/** Connects required Redis capabilities and owns their shared shutdown. */
export class RedisLifecycle implements ShutdownParticipant {
  public readonly name = 'redis' as const
  public readonly order = REDIS_SHUTDOWN_ORDER
  private connectPromise?: Promise<void>
  private closePromise?: Promise<void>

  public constructor(
    private readonly registry: RedisConnectionRegistry,
    private readonly shutdownTimeoutMs: number,
  ) {}

  /** Starts all required Redis capabilities once. */
  public connect(signal: AbortSignal): Promise<void> {
    this.connectPromise ??= this.registry.connectRequired(signal)
    return this.connectPromise
  }

  /** Closes all opened Redis capabilities once. */
  public close(signal: AbortSignal): Promise<void> {
    this.closePromise ??= this.registry.closeAll(
      AbortSignal.any([signal, AbortSignal.timeout(this.shutdownTimeoutMs)]),
    )
    return this.closePromise
  }
}
