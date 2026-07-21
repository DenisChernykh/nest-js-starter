import type { StartedRedisContainer } from '@testcontainers/redis'

import { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'
import { RedisClientFactory } from '@/platform/redis/redis-client.factory'
import { RedisConnectionRegistry } from '@/platform/redis/redis-connection.registry'
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
    readonly registry: RedisConnectionRegistry
    readonly lifecycle: RedisLifecycle
    readonly readiness: RedisReadinessIndicator
  } {
    const registry = new RedisConnectionRegistry(
      new RedisClientFactory({ connectTimeoutMs: 1_000, commandTimeoutMs }),
      new ActiveOperationTracker(),
      {
        coordinationUrl: container.getConnectionUrl(),
        connectTimeoutMs: 1_000,
        commandTimeoutMs,
      },
    )
    registry.register('coordination', true)
    registry.seal()
    return {
      registry,
      lifecycle: new RedisLifecycle(registry, 1_000),
      readiness: new RedisReadinessIndicator(registry, commandTimeoutMs),
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
    const { registry, lifecycle, readiness } = createRuntime(25)
    await lifecycle.connect(AbortSignal.timeout(2_000))
    await registry
      .executor('coordination')
      .execute('pause', (client) =>
        client.sendCommand(['CLIENT', 'PAUSE', '150']),
      )

    await expect(
      registry
        .executor('coordination')
        .execute('ping-during-pause', (client) => client.ping()),
    ).rejects.toThrow('Redis command deadline exceeded')
    expect(registry.client('coordination').isOpen).toBe(false)

    await waitForCondition(async () => {
      try {
        return (
          (await registry
            .executor('coordination')
            .execute('recovery-ping', (client) => client.ping())) === 'PONG'
        )
      } catch {
        return false
      }
    }, 2_000)
    await expect(readiness.check(AbortSignal.timeout(250))).resolves.toBe('up')
    await lifecycle.close(AbortSignal.timeout(1_000))
  })
})
