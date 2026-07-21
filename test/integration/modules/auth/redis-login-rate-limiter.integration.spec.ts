import type { StartedRedisContainer } from '@testcontainers/redis'

import { AuthDependencyUnavailableError } from '@/modules/auth/application/auth-errors'
import { NodeAuthCryptoAdapter } from '@/modules/auth/infrastructure/node-auth-crypto.adapter'
import { RedisLoginRateLimiter } from '@/modules/auth/infrastructure/redis-login-rate-limiter'
import { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'
import type { RedisCapabilityExecutor } from '@/platform/redis/redis-capability'
import { RedisClientFactory } from '@/platform/redis/redis-client.factory'
import { RedisConnectionRegistry } from '@/platform/redis/redis-connection.registry'
import { RedisLifecycle } from '@/platform/redis/redis-lifecycle'
import { startRedisContainer } from '@test/integration/support/redis-container'

const hmacSecret = new Uint8Array(Buffer.alloc(32, 3))

describe('RedisLoginRateLimiter', () => {
  let container: StartedRedisContainer
  let lifecycle: RedisLifecycle
  let executor: RedisCapabilityExecutor
  let crypto: NodeAuthCryptoAdapter

  beforeAll(async () => {
    container = await startRedisContainer()
    const runtime = createRedisRuntime(container)
    lifecycle = runtime.lifecycle
    executor = runtime.executor
    crypto = new NodeAuthCryptoAdapter()
    await lifecycle.connect(AbortSignal.timeout(2_000))
  })

  afterEach(async () => {
    await executor.execute('test-flush', (client) =>
      client.sendCommand<string>(['FLUSHDB']),
    )
  })

  afterAll(async () => {
    await lifecycle.close(AbortSignal.timeout(1_000))
    await container.stop()
  })

  function createRedisRuntime(target: StartedRedisContainer): {
    readonly lifecycle: RedisLifecycle
    readonly executor: RedisCapabilityExecutor
  } {
    const registry = new RedisConnectionRegistry(
      new RedisClientFactory({
        connectTimeoutMs: 500,
        commandTimeoutMs: 500,
      }),
      new ActiveOperationTracker(),
      {
        coordinationUrl: target.getConnectionUrl(),
        commandTimeoutMs: 500,
      },
    )
    registry.register('coordination', true)
    registry.seal()
    return {
      lifecycle: new RedisLifecycle(registry, 500),
      executor: registry.executor('coordination'),
    }
  }

  function limiter(target = executor): RedisLoginRateLimiter {
    return new RedisLoginRateLimiter(target, crypto, {
      keyPrefix: 'nest-js-starter',
      environment: 'test',
      hmacSecret,
      ipLimit: 3,
      accountLimit: 4,
      windowMs: 2_000,
    })
  }

  it('atomically enforces both buckets across adapter instances', async () => {
    const first = limiter()
    const second = limiter()
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 === 0 ? first : second).consume({
          ipAddress: '203.0.113.10',
          normalizedEmail: 'user@example.com',
        }),
      ),
    )

    expect(attempts.filter((attempt) => attempt.allowed)).toHaveLength(3)
    for (const denied of attempts.filter((attempt) => !attempt.allowed)) {
      expect(denied.retryAfterMs).toBeGreaterThan(0)
      expect(denied.retryAfterMs).toBeLessThanOrEqual(2_000)
    }
  })

  it('HMAC-keys both finite buckets and never stores public input', async () => {
    const target = limiter()
    const ipAddress = '198.51.100.25'
    const email = 'private@example.com'
    await target.consume({ ipAddress, normalizedEmail: email })
    const ipDigest = crypto.hmac(hmacSecret, `ip:${ipAddress}`)
    const accountDigest = crypto.hmac(hmacSecret, `account:${email}`)
    const keys = [
      `nest-js-starter:test:coordination:v1:login-rate-ip:${ipDigest}`,
      `nest-js-starter:test:coordination:v1:login-rate-account:${accountDigest}`,
    ]

    for (const key of keys) {
      expect(key).not.toContain(ipAddress)
      expect(key).not.toContain(email)
      await expect(
        executor.execute('test-ttl', (client) =>
          client.sendCommand<number>(['PTTL', key]),
        ),
      ).resolves.toBeGreaterThan(0)
    }
  })

  it('fails closed after a real Redis outage', async () => {
    const outageContainer = await startRedisContainer()
    const outageRuntime = createRedisRuntime(outageContainer)
    const target = limiter(outageRuntime.executor)
    await outageContainer.stop()

    await expect(
      target.consume({
        ipAddress: '192.0.2.1',
        normalizedEmail: 'outage@example.com',
      }),
    ).rejects.toBeInstanceOf(AuthDependencyUnavailableError)
    await outageRuntime.lifecycle.close(AbortSignal.timeout(1_000))
  })
})
