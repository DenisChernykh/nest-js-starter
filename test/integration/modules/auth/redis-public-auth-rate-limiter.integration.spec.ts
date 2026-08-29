import type { StartedRedisContainer } from '@testcontainers/redis'

import { NodeAccountLifecycleCryptoAdapter } from '@/modules/auth/account-lifecycle/infrastructure/node-account-lifecycle-crypto.adapter'
import { NodePasswordAuthCryptoAdapter } from '@/modules/auth/authentication/infrastructure/node-password-auth-crypto.adapter'
import { RedisLoginRateLimiter } from '@/modules/auth/authentication/infrastructure/redis-login-rate-limiter'
import { RedisPublicAuthRateLimiter } from '@/modules/auth/infrastructure/redis-public-auth-rate-limiter'
import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'
import { RedisClientFactory } from '@/platform/redis/redis-client.factory'
import { RedisAuthConnectionManager } from '@/platform/redis/redis-auth.connection'
import { RedisLifecycle } from '@/platform/redis/redis-lifecycle'
import { startRedisContainer } from '@test/integration/support/redis-container'

const hmacSecret = new Uint8Array(Buffer.alloc(32, 7))

describe('RedisPublicAuthRateLimiter', () => {
  let container: StartedRedisContainer
  let lifecycle: RedisLifecycle
  let executor: RedisCommandExecutorPort
  let crypto: NodeAccountLifecycleCryptoAdapter

  beforeAll(async () => {
    container = await startRedisContainer()
    const connection = new RedisAuthConnectionManager(
      new RedisClientFactory({
        connectTimeoutMs: 500,
        commandTimeoutMs: 500,
      }),
      {
        authUrl: container.getConnectionUrl(),
        connectTimeoutMs: 500,
        commandTimeoutMs: 500,
      },
    )
    lifecycle = new RedisLifecycle(connection, 500)
    executor = connection.commandExecutor
    crypto = new NodeAccountLifecycleCryptoAdapter()
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

  function createLimiter(target = executor): RedisPublicAuthRateLimiter {
    return new RedisPublicAuthRateLimiter(target, crypto, {
      keyPrefix: 'nest-js-starter',
      environment: 'test',
      hmacSecret,
      registrationIpLimit: 10,
      registrationAccountLimit: 2,
      resendIpLimit: 10,
      resendAccountLimit: 3,
      resetRequestIpLimit: 10,
      resetRequestAccountLimit: 3,
      requestWindowMs: 3_600_000,
      resendCooldownMs: 60_000,
    })
  }

  it('atomically enforces account limits across adapter instances', async () => {
    const first = createLimiter()
    const second = createLimiter()
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 === 0 ? first : second).consume({
          operation: 'register',
          ipAddress: `198.51.100.${index + 1}`,
          normalizedEmail: 'same@example.com',
        }),
      ),
    )

    expect(attempts.filter((attempt) => attempt.allowed)).toHaveLength(2)
    for (const denied of attempts.filter((attempt) => !attempt.allowed)) {
      expect(denied.retryAfterMs).toBeGreaterThan(0)
      expect(denied.retryAfterMs).toBeLessThanOrEqual(3_600_000)
    }
  })

  it('denies resend cooldown before changing either finite bucket', async () => {
    const limiter = createLimiter()
    const input = {
      operation: 'email-verification-resend' as const,
      ipAddress: '203.0.113.10',
      normalizedEmail: 'user@example.com',
    }

    await expect(limiter.consume(input)).resolves.toEqual({ allowed: true })
    const denied = await limiter.consume(input)
    expect(denied.allowed).toBe(false)
    if (denied.allowed) throw new Error('Expected cooldown denial')
    expect(denied.retryAfterMs).toBeGreaterThan(0)

    const ipDigest = crypto.hmac(hmacSecret, `ip:${input.ipAddress}`)
    const accountDigest = crypto.hmac(
      hmacSecret,
      `account:${input.normalizedEmail}`,
    )
    const base = 'nest-js-starter:test:auth:public:v1:email-verification-resend'
    const ipKey = `${base}:ip:${ipDigest}`
    const accountKey = `${base}:account:${accountDigest}`
    await expect(
      executor.execute('test-public-ip-count', (client) =>
        client.sendCommand<string>(['GET', ipKey]),
      ),
    ).resolves.toBe('1')
    await expect(
      executor.execute('test-public-account-count', (client) =>
        client.sendCommand<string>(['GET', accountKey]),
      ),
    ).resolves.toBe('1')
  })

  it('keeps public operation keys isolated from the existing login limiter', async () => {
    const publicLimiter = createLimiter()
    const loginLimiter = new RedisLoginRateLimiter(
      executor,
      new NodePasswordAuthCryptoAdapter(),
      {
        keyPrefix: 'nest-js-starter',
        environment: 'test',
        hmacSecret,
        ipLimit: 20,
        accountLimit: 10,
        windowMs: 900_000,
      },
    )
    const input = {
      ipAddress: '192.0.2.25',
      normalizedEmail: 'isolated@example.com',
    }

    await publicLimiter.consume({
      ...input,
      operation: 'password-reset-request',
    })
    await loginLimiter.consume(input)

    const ipDigest = crypto.hmac(hmacSecret, `ip:${input.ipAddress}`)
    const accountDigest = crypto.hmac(
      hmacSecret,
      `account:${input.normalizedEmail}`,
    )
    await expect(
      executor.execute('test-login-ip-count', (client) =>
        client.sendCommand<string>([
          'GET',
          `nest-js-starter:test:auth:v1:login-rate-ip:${ipDigest}`,
        ]),
      ),
    ).resolves.toBe('1')
    await expect(
      executor.execute('test-public-account-count', (client) =>
        client.sendCommand<string>([
          'GET',
          `nest-js-starter:test:auth:public:v1:password-reset-request:account:${accountDigest}`,
        ]),
      ),
    ).resolves.toBe('1')
  })
})
