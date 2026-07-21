import { createClient } from 'redis'

import type { RedisManagedClient } from './redis-capability'

/** Non-secret connection deadlines applied to each node-redis client. */
export interface RedisClientFactoryConfig {
  readonly connectTimeoutMs: number
  readonly commandTimeoutMs: number
}

/** Driver creation options kept testable without exporting node-redis types. */
export interface RedisDriverCreateOptions {
  readonly url: string
  readonly disableOfflineQueue: true
  readonly commandsQueueMaxLength: number
  readonly connectTimeoutMs: number
  readonly commandTimeoutMs: number
  readonly tls: boolean
}

/** Constructs a narrowed Redis driver from reviewed platform options. */
export type RedisDriverCreator = (
  options: RedisDriverCreateOptions,
) => RedisManagedClient

function createNodeRedisDriver(
  options: RedisDriverCreateOptions,
): RedisManagedClient {
  const socketOptions = {
    connectTimeout: options.connectTimeoutMs,
    reconnectStrategy: (retries: number) => Math.min(50 * 2 ** retries, 1_000),
  }
  const client = createClient({
    url: options.url,
    disableOfflineQueue: options.disableOfflineQueue,
    commandsQueueMaxLength: options.commandsQueueMaxLength,
    commandOptions: { timeout: options.commandTimeoutMs },
    socket: options.tls
      ? { ...socketOptions, tls: true as const }
      : socketOptions,
  })

  const wrap = (driver: typeof client): RedisManagedClient => ({
    get isOpen() {
      return driver.isOpen
    },
    get isReady() {
      return driver.isReady
    },
    connect: () => driver.connect(),
    ping: () => driver.ping(),
    sendCommand: <T>(command: readonly string[]) =>
      driver.sendCommand<T>([...command]),
    close: () => driver.close(),
    destroy: () => driver.destroy(),
    duplicate: () => wrap(driver.duplicate()),
    onError: (listener) => {
      driver.on('error', listener)
    },
  })
  return wrap(client)
}

/** Creates fail-fast Redis clients without exposing the concrete driver. */
export class RedisClientFactory {
  public constructor(
    private readonly config: RedisClientFactoryConfig,
    private readonly createDriver: RedisDriverCreator = createNodeRedisDriver,
  ) {}

  /** Creates one disconnected client and installs its required error listener. */
  public create(url: string): RedisManagedClient {
    const client = this.createDriver({
      url,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 1_000,
      connectTimeoutMs: this.config.connectTimeoutMs,
      commandTimeoutMs: this.config.commandTimeoutMs,
      tls: new URL(url).protocol === 'rediss:',
    })
    client.onError(() => undefined)
    return client
  }
}
