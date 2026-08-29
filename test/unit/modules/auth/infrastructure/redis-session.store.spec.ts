import { AuthDependencyUnavailableError } from '@/modules/auth/application/auth-errors'
import { RedisSessionStore } from '@/modules/auth/infrastructure/redis-session.store'
import { NodeSessionCryptoAdapter } from '@/modules/auth/sessions/infrastructure/node-session-crypto.adapter'
import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'

describe('RedisSessionStore dependency boundary', () => {
  it('maps a session-create Redis failure to a safe auth dependency error', async () => {
    const executor: RedisCommandExecutorPort = {
      execute: jest.fn(() => Promise.reject(new Error('redis driver detail'))),
    } as RedisCommandExecutorPort
    const target = new RedisSessionStore(
      executor,
      new NodeSessionCryptoAdapter(),
      {
        keyPrefix: 'nest-js-starter',
        environment: 'test',
        sessionKeySecret: new Uint8Array(Buffer.alloc(32, 1)),
        csrfSecret: new Uint8Array(Buffer.alloc(32, 2)),
        idleTimeoutMs: 1_000,
        absoluteTimeoutMs: 5_000,
        touchIntervalMs: 100,
      },
    )

    await expect(
      target.issue({
        userId: 'user',
        sessionGeneration: 1n,
        globalSessionEpoch: 1n,
        nowMs: 1,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).rejects.toBeInstanceOf(AuthDependencyUnavailableError)
  })
})
