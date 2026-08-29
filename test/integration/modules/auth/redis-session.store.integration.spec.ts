import type { StartedRedisContainer } from '@testcontainers/redis'

import type { IssuedBrowserSession } from '@/modules/auth/application/session-store.port'
import { RedisSessionStore } from '@/modules/auth/infrastructure/redis-session.store'
import { NodeSessionCryptoAdapter } from '@/modules/auth/sessions/infrastructure/node-session-crypto.adapter'
import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'
import { RedisClientFactory } from '@/platform/redis/redis-client.factory'
import { RedisAuthConnectionManager } from '@/platform/redis/redis-auth.connection'
import { RedisLifecycle } from '@/platform/redis/redis-lifecycle'
import { startRedisContainer } from '@test/integration/support/redis-container'

const sessionKeySecret = new Uint8Array(Buffer.alloc(32, 1))
const csrfSecret = new Uint8Array(Buffer.alloc(32, 2))
const userId = '0f739752-52a2-45bc-aa9f-3de43f47f47b'
const otherUserId = '7b93f4d8-b86b-4f68-ac4b-3d9ff0408c88'

describe('RedisSessionStore', () => {
  let container: StartedRedisContainer
  let lifecycle: RedisLifecycle
  let executor: RedisCommandExecutorPort
  let crypto: NodeSessionCryptoAdapter
  let store: RedisSessionStore

  beforeAll(async () => {
    container = await startRedisContainer()
    const connection = new RedisAuthConnectionManager(
      new RedisClientFactory({
        connectTimeoutMs: 1_000,
        commandTimeoutMs: 1_000,
      }),
      {
        authUrl: container.getConnectionUrl(),
        connectTimeoutMs: 1_000,
        commandTimeoutMs: 1_000,
      },
    )
    lifecycle = new RedisLifecycle(connection, 1_000)
    await lifecycle.connect(AbortSignal.timeout(2_000))
    executor = connection.commandExecutor
    crypto = new NodeSessionCryptoAdapter()
    store = createStore(executor, crypto)
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

  function createStore(
    target: RedisCommandExecutorPort,
    authCrypto: NodeSessionCryptoAdapter,
    overrides: Partial<{
      idleTimeoutMs: number
      absoluteTimeoutMs: number
      touchIntervalMs: number
    }> = {},
  ): RedisSessionStore {
    return new RedisSessionStore(target, authCrypto, {
      keyPrefix: 'nest-js-starter',
      environment: 'test',
      sessionKeySecret,
      csrfSecret,
      idleTimeoutMs: 1_000,
      absoluteTimeoutMs: 5_000,
      touchIntervalMs: 100,
      ...overrides,
    })
  }

  function issue(
    target = store,
    nowMs = Date.now(),
  ): Promise<IssuedBrowserSession> {
    return target.issue({
      userId,
      sessionGeneration: 2n,
      globalSessionEpoch: 3n,
      nowMs,
      deviceLabel: 'Firefox on macOS',
      networkFingerprint: 'network-hmac',
    })
  }

  it('stores only a token digest and gives every temporary key a TTL', async () => {
    const nowMs = Date.now()
    const issued = await issue(store, nowMs)
    const digest = crypto.hmac(sessionKeySecret, issued.rawToken)
    const sessionKey = `nest-js-starter:test:auth:v1:session:${digest}`
    const indexKey = `nest-js-starter:test:auth:v1:user-sessions:${userId}`
    const [payload, sessionTtl, indexTtl] = await executor.execute(
      'test-inspect-session',
      async (client) =>
        Promise.all([
          client.sendCommand<string>(['GET', sessionKey]),
          client.sendCommand<number>(['PTTL', sessionKey]),
          client.sendCommand<number>(['PTTL', indexKey]),
        ]),
    )

    expect(sessionKey).not.toContain(issued.rawToken)
    expect(payload).not.toContain(issued.rawToken)
    expect(sessionTtl).toBeGreaterThan(0)
    expect(sessionTtl).toBeLessThanOrEqual(1_000)
    expect(indexTtl).toBeGreaterThan(0)
    expect(indexTtl).toBeLessThanOrEqual(5_000)
    expect(issued.csrfToken).not.toBe(issued.rawToken)
  })

  it.each([
    { idleTimeoutMs: 0 },
    { absoluteTimeoutMs: 999 },
    { touchIntervalMs: 0 },
    { touchIntervalMs: 1_000 },
  ])('rejects an invalid finite expiry policy: %o', (overrides) => {
    expect(() => createStore(executor, crypto, overrides)).toThrow(
      'Redis session expiry policy is invalid',
    )
  })

  it('throttles touch, bounds absolute expiry and lists current metadata', async () => {
    const nowMs = Date.now()
    const issued = await issue(store, nowMs)

    const first = await store.readAndTouch(issued.rawToken, nowMs + 50)
    const touched = await store.readAndTouch(issued.rawToken, nowMs + 150)
    const sessions = await store.list(userId, issued.publicId)

    expect(first?.lastSeenAtMs).toBe(nowMs)
    expect(touched?.lastSeenAtMs).toBe(nowMs + 150)
    expect(touched?.absoluteExpiresAtMs).toBe(nowMs + 5_000)
    expect(sessions).toEqual([
      expect.objectContaining({
        publicId: issued.publicId,
        current: true,
        deviceLabel: 'Firefox on macOS',
      }),
    ])
    await expect(
      store.readAndTouch(issued.rawToken, nowMs + 5_000),
    ).resolves.toBeUndefined()
  })

  it('checks ownership and makes revoke idempotent', async () => {
    const issued = await issue()

    await expect(store.revoke(otherUserId, issued.publicId)).resolves.toBe(
      false,
    )
    await expect(store.revoke(userId, issued.publicId)).resolves.toBe(true)
    await expect(store.revoke(userId, issued.publicId)).resolves.toBe(false)
    await expect(
      store.readAndTouch(issued.rawToken, Date.now()),
    ).resolves.toBeUndefined()
  })

  it('revokes only the indexed sessions for one user', async () => {
    const first = await issue()
    const second = await issue()

    await expect(store.revokeAll(userId)).resolves.toBe(2)
    await expect(store.list(userId, first.publicId)).resolves.toEqual([])
    await expect(
      store.readAndTouch(second.rawToken, Date.now()),
    ).resolves.toBeUndefined()
  })

  it('treats cleanup of a user without indexed sessions as idempotent', async () => {
    await expect(store.revokeAll(userId)).resolves.toBe(0)
  })

  it('fails closed and deletes a malformed record', async () => {
    const issued = await issue()
    const digest = crypto.hmac(sessionKeySecret, issued.rawToken)
    const sessionKey = `nest-js-starter:test:auth:v1:session:${digest}`
    await executor.execute('test-corrupt', (client) =>
      client.sendCommand<string>(['SET', sessionKey, '{', 'PX', '1000']),
    )

    await expect(
      store.readAndTouch(issued.rawToken, Date.now()),
    ).resolves.toBeUndefined()
    await expect(
      executor.execute('test-exists', (client) =>
        client.sendCommand<number>(['EXISTS', sessionKey]),
      ),
    ).resolves.toBe(0)
  })

  it('does not resurrect a session during concurrent touch and revoke', async () => {
    const issued = await issue()

    await Promise.allSettled([
      store.readAndTouch(issued.rawToken, Date.now() + 200),
      store.revoke(userId, issued.publicId),
    ])

    await expect(
      store.readAndTouch(issued.rawToken, Date.now() + 300),
    ).resolves.toBeUndefined()
  })
})
