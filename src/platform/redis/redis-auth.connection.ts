import type {
  RedisClientFactory,
  RedisManagedClient,
} from './redis-client.factory'
import {
  RedisCommandExecutor,
  type RedisCommandExecutorPort,
} from './redis-command.executor'

/** Configuration for the single Redis auth connection. */
export interface RedisAuthConnectionConfig {
  readonly authUrl: string
  readonly connectTimeoutMs: number
  readonly commandTimeoutMs: number
}

/** Owns the auth client, command executor and bounded lifecycle. */
export class RedisAuthConnectionManager {
  public readonly commandExecutor: RedisCommandExecutorPort
  private readonly client: RedisManagedClient
  private readonly executor: RedisCommandExecutor
  private connectPromise: Promise<void> | undefined
  private closePromise: Promise<void> | undefined
  private connectionAdmissionOpen = true

  public constructor(
    factory: RedisClientFactory,
    private readonly config: RedisAuthConnectionConfig,
  ) {
    this.client = factory.create(config.authUrl)
    this.executor = new RedisCommandExecutor(
      this.client,
      config.commandTimeoutMs,
    )
    this.commandExecutor = Object.freeze({
      execute: <T>(
        operationName: string,
        operation: (client: RedisManagedClient) => Promise<T>,
        signal?: AbortSignal,
      ): Promise<T> => this.execute(operationName, operation, signal),
    })
  }

  /** Connects the required auth dependency once. */
  public connect(signal: AbortSignal): Promise<void> {
    if (!this.connectionAdmissionOpen) {
      return Promise.reject(new Error('Redis connection admission is closed'))
    }
    if (this.client.isReady) return Promise.resolve()
    this.connectPromise ??= this.connectInternal(signal).finally(() => {
      this.connectPromise = undefined
    })
    return this.connectPromise
  }

  /** Closes the auth dependency once within the supplied deadline. */
  public close(signal: AbortSignal): Promise<void> {
    this.connectionAdmissionOpen = false
    this.closePromise ??= this.closeInternal(signal)
    return this.closePromise
  }

  private async execute<T>(
    operationName: string,
    operation: (client: RedisManagedClient) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    await this.connect(signal ?? new AbortController().signal)
    return this.executor.execute(operationName, operation, signal)
  }

  private async connectInternal(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('Redis connection deadline exceeded')
    await this.bound(
      this.client.connect(),
      signal,
      this.config.connectTimeoutMs,
      () => {
        this.client.destroy()
      },
    )
  }

  private async closeInternal(signal: AbortSignal): Promise<void> {
    if (!this.client.isOpen) return
    await this.bound(
      this.client.close(),
      signal,
      this.config.commandTimeoutMs,
      () => {
        this.client.destroy()
      },
    )
  }

  private bound(
    operation: Promise<unknown>,
    signal: AbortSignal,
    timeoutMs: number,
    abortOperation: () => void,
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
          abortOperation()
        } catch {
          /* cleanup is best effort */
        }
        finish(() => reject(new Error('Redis connection deadline exceeded')))
      }
      const timer = setTimeout(abort, timeoutMs)
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
      void operation.then(
        () => finish(resolve),
        (error: unknown) =>
          finish(() =>
            reject(
              error instanceof Error
                ? error
                : new Error('Redis operation failed'),
            ),
          ),
      )
    })
  }
}
