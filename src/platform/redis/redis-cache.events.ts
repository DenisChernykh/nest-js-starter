/** Stable event names emitted by the typed Redis cache primitive. */
export type RedisCacheEventType =
  'hit' | 'miss' | 'invalid' | 'error' | 'write' | 'invalidate'

/** Non-secret in-process cache event suitable for later telemetry binding. */
export interface RedisCacheEvent {
  readonly type: RedisCacheEventType
  readonly key: string
}

/** Listener for one non-durable in-process cache event. */
export type RedisCacheEventListener = (event: RedisCacheEvent) => void

/** Publishes typed best-effort cache events without affecting cache behavior. */
export class RedisCacheEvents {
  private readonly listeners = new Set<RedisCacheEventListener>()

  /** Registers a listener and returns its idempotent unsubscribe callback. */
  public subscribe(listener: RedisCacheEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Publishes an event synchronously while isolating listener failures. */
  public publish(event: RedisCacheEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A telemetry consumer cannot change cache correctness.
      }
    }
  }
}
