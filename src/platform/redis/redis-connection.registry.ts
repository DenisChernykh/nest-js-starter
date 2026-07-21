import type { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'

import type {
  RedisCapability,
  RedisCapabilityExecutor,
  RedisManagedClient,
} from './redis-capability'
import type { RedisClientFactory } from './redis-client.factory'
import { RedisCommandExecutor } from './redis-command.executor'

/** URLs and deadline required by the capability registry. */
export interface RedisConnectionRegistryConfig {
  readonly coordinationUrl: string
  readonly cacheUrl?: string
  readonly connectTimeoutMs?: number
  readonly commandTimeoutMs: number
}

interface RegisteredConnection {
  readonly capability: RedisCapability
  readonly required: boolean
  readonly client: RedisManagedClient
  readonly executor: RedisCommandExecutor
  connectPromise: Promise<void> | undefined
}

/** Owns one sealed set of capability-scoped Redis connections. */
export class RedisConnectionRegistry {
  private readonly connections = new Map<
    RedisCapability,
    RegisteredConnection
  >()
  private sealed = false

  public constructor(
    private readonly factory: RedisClientFactory,
    private readonly operationTracker: ActiveOperationTracker,
    private readonly config: RedisConnectionRegistryConfig,
  ) {}

  /** Registers one unique capability before the registry is sealed. */
  public register(capability: RedisCapability, required: boolean): void {
    if (this.sealed || this.connections.has(capability)) {
      throw new Error('Redis capability registration rejected')
    }
    if (capability === 'pubsub') {
      throw new Error('Redis pubsub requires a dedicated duplicate')
    }
    const url = this.urlFor(capability)
    const client = this.factory.create(url)
    this.connections.set(
      capability,
      this.createConnection(capability, required, client),
    )
  }

  /** Registers pubsub as a dedicated duplicate of an existing command client. */
  public registerSubscriber(source: 'coordination' | 'cache'): void {
    if (this.sealed || this.connections.has('pubsub')) {
      throw new Error('Redis capability registration rejected')
    }
    const client = this.connection(source).client.duplicate()
    client.onError(() => undefined)
    this.connections.set(
      'pubsub',
      this.createConnection('pubsub', false, client),
    )
  }

  /** Permanently closes capability registration. */
  public seal(): void {
    this.sealed = true
  }

  /** Connects every required capability in stable registration order. */
  public async connectRequired(signal: AbortSignal): Promise<void> {
    this.assertSealed()
    for (const connection of this.connections.values()) {
      if (connection.required) await this.connect(connection, signal)
    }
  }

  /** Returns a lazy executor that connects its capability on first use. */
  public executor(capability: RedisCapability): RedisCapabilityExecutor {
    this.assertSealed()
    const connection = this.connection(capability)
    return {
      execute: async (operationName, operation, signal) => {
        await this.connect(connection, signal ?? new AbortController().signal)
        return connection.executor.execute(operationName, operation, signal)
      },
    }
  }

  /** Returns the managed client for readiness and lifecycle adapters. */
  public client(capability: RedisCapability): RedisManagedClient {
    return this.connection(capability).client
  }

  /** Closes all opened clients and destroys them when cooperative close fails. */
  public async closeAll(signal: AbortSignal): Promise<void> {
    const failures: unknown[] = []
    for (const connection of [...this.connections.values()].reverse()) {
      if (!connection.client.isOpen) continue
      try {
        await this.close(connection.client, signal)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new Error('Redis cleanup incomplete')
  }

  private async connect(
    connection: RegisteredConnection,
    signal: AbortSignal,
  ): Promise<void> {
    if (connection.client.isReady) return
    if (signal.aborted) throw new Error('Redis connection aborted')
    if (connection.connectPromise === undefined) {
      const driverAttempt = connection.client.connect().then(() => undefined)
      const attempt = this.boundConnect(
        connection.client,
        driverAttempt,
        signal,
      )
      connection.connectPromise = attempt
      const clearAttempt = (): void => {
        if (connection.connectPromise === attempt)
          connection.connectPromise = undefined
      }
      void attempt.then(clearAttempt, clearAttempt)
    }
    await connection.connectPromise
  }

  private boundConnect(
    client: RedisManagedClient,
    driverAttempt: Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        callback()
      }
      const abort = (): void => {
        try {
          client.destroy()
        } catch {
          // A concurrent close may already own the socket transition.
        }
        finish(() => reject(new Error('Redis connection deadline exceeded')))
      }
      const timer = setTimeout(
        abort,
        this.config.connectTimeoutMs ?? this.config.commandTimeoutMs,
      )
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
      void driverAttempt.then(
        () => finish(resolve),
        (error: unknown) =>
          finish(() =>
            reject(
              error instanceof Error
                ? error
                : new Error('Redis connection failed without an Error cause'),
            ),
          ),
      )
    })
  }

  private close(
    client: RedisManagedClient,
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const aborted = (): void => {
        try {
          client.destroy()
        } catch {
          // Idempotent cleanup still reports the missed graceful deadline.
        }
        reject(new Error('Redis close aborted'))
      }
      if (signal.aborted) return aborted()
      signal.addEventListener('abort', aborted, { once: true })
      void client.close().then(
        () => {
          signal.removeEventListener('abort', aborted)
          resolve()
        },
        (error: unknown) => {
          signal.removeEventListener('abort', aborted)
          try {
            client.destroy()
          } catch {
            // The failed close may already have closed the socket.
          }
          reject(
            error instanceof Error
              ? error
              : new Error('Redis close failed without an Error cause'),
          )
        },
      )
    })
  }

  private connection(capability: RedisCapability): RegisteredConnection {
    const connection = this.connections.get(capability)
    if (connection === undefined)
      throw new Error('Redis capability unavailable')
    return connection
  }

  private createConnection(
    capability: RedisCapability,
    required: boolean,
    client: RedisManagedClient,
  ): RegisteredConnection {
    return {
      capability,
      required,
      client,
      connectPromise: undefined,
      executor: new RedisCommandExecutor(
        client,
        this.operationTracker,
        this.config.commandTimeoutMs,
      ),
    }
  }

  private urlFor(capability: RedisCapability): string {
    if (capability === 'coordination') return this.config.coordinationUrl
    if (capability === 'cache' && this.config.cacheUrl !== undefined) {
      return this.config.cacheUrl
    }
    throw new Error('Redis capability URL is not configured')
  }

  private assertSealed(): void {
    if (!this.sealed) throw new Error('Redis connection registry is not sealed')
  }
}
