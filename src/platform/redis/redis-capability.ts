/** Redis connection roles supported by the core platform. */
export type RedisCapability = 'coordination' | 'cache' | 'pubsub'

/** Narrow driver boundary retained entirely inside Redis infrastructure. */
export interface RedisManagedClient {
  readonly isOpen: boolean
  readonly isReady: boolean
  connect(): Promise<unknown>
  ping(): Promise<string>
  sendCommand<T>(command: readonly string[]): Promise<T>
  close(): Promise<unknown>
  destroy(): void
  duplicate(): RedisManagedClient
  onError(listener: (error: unknown) => void): void
}

/** Minimal executor exposed to module-owned Redis adapters. */
export interface RedisCapabilityExecutor {
  execute<T>(
    operationName: string,
    operation: (client: RedisManagedClient) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>
}
