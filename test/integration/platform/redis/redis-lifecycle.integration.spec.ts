import type { StartedRedisContainer } from '@testcontainers/redis'

import { RedisClientFactory } from '@/platform/redis/redis-client.factory'
import { RedisAuthConnectionManager } from '@/platform/redis/redis-auth.connection'
import { RedisLifecycle } from '@/platform/redis/redis-lifecycle'
import { RedisReadinessIndicator } from '@/platform/redis/redis-readiness.indicator'
import { startRedisContainer } from '@test/integration/support/redis-container'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

describe('Redis lifecycle', () => {
  let container: StartedRedisContainer

  beforeAll(async () => {
    container = await startRedisContainer()
  })

  afterAll(async () => {
    await container.stop()
  })

  function createRuntime(commandTimeoutMs = 250): {
    readonly connection: RedisAuthConnectionManager
    readonly lifecycle: RedisLifecycle
    readonly readiness: RedisReadinessIndicator
  } {
    const connection = new RedisAuthConnectionManager(
      new RedisClientFactory({ connectTimeoutMs: 1_000, commandTimeoutMs }),
      {
        authUrl: container.getConnectionUrl(),
        connectTimeoutMs: 1_000,
        commandTimeoutMs,
      },
    )
    return {
      connection,
      lifecycle: new RedisLifecycle(connection, 1_000),
      readiness: new RedisReadinessIndicator(connection, commandTimeoutMs),
    }
  }

  it('connects through the ACL URL, PINGs and closes idempotently', async () => {
    const { lifecycle, readiness } = createRuntime()
    await lifecycle.connect(AbortSignal.timeout(2_000))

    await expect(readiness.check(AbortSignal.timeout(1_000))).resolves.toBe(
      'up',
    )
    await expect(
      Promise.all([
        lifecycle.close(AbortSignal.timeout(1_000)),
        lifecycle.close(AbortSignal.timeout(1_000)),
      ]),
    ).resolves.toEqual([undefined, undefined])
    await expect(readiness.check(AbortSignal.timeout(250))).resolves.toBe(
      'down',
    )
  })

  it('settles a paused command by destroying its socket and reconnects', async () => {
    const { connection, lifecycle, readiness } = createRuntime(25)
    await lifecycle.connect(AbortSignal.timeout(2_000))
    await connection.commandExecutor.execute('pause', (client) =>
      client.sendCommand(['CLIENT', 'PAUSE', '150']),
    )

    await expect(
      connection.commandExecutor.execute('ping-during-pause', (client) =>
        client.ping(),
      ),
    ).rejects.toThrow('Redis command deadline exceeded')

    await waitForCondition(async () => {
      try {
        return (
          (await connection.commandExecutor.execute('recovery-ping', (client) =>
            client.ping(),
          )) === 'PONG'
        )
      } catch {
        return false
      }
    }, 2_000)
    await expect(readiness.check(AbortSignal.timeout(250))).resolves.toBe('up')
    await lifecycle.close(AbortSignal.timeout(1_000))
  })
})
