import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'
import type { RedisManagedClient } from '@/platform/redis/redis-client.factory'
import { NodeAccountLifecycleCryptoAdapter } from '@/modules/identity-access/account-lifecycle/infrastructure/node-account-lifecycle-crypto.adapter'
import { RedisPublicAuthRateLimiter } from '@/modules/identity-access/account-lifecycle/infrastructure/redis-public-auth-rate-limiter'

function harness(response: readonly [number, number] = [1, 0]): {
  readonly limiter: RedisPublicAuthRateLimiter
  readonly execute: jest.MockedFunction<RedisCommandExecutorPort['execute']>
} {
  const sendCommand = jest.fn((command: readonly string[]): Promise<unknown> =>
    Promise.resolve(command[0] === 'SCRIPT' ? 'a'.repeat(40) : response),
  )
  const client = {
    sendCommand: <T>(command: readonly string[]): Promise<T> =>
      sendCommand(command) as Promise<T>,
  } as RedisManagedClient
  const execute = jest.fn() as jest.MockedFunction<
    RedisCommandExecutorPort['execute']
  >
  execute.mockImplementation((_name, operation) => operation(client))
  const limiter = new RedisPublicAuthRateLimiter(
    { execute },
    new NodeAccountLifecycleCryptoAdapter(() => Buffer.alloc(32, 9)),
    {
      keyPrefix: 'nest-js-starter',
      environment: 'test',
      hmacSecret: Buffer.alloc(32, 1),
      registrationIpLimit: 10,
      registrationAccountLimit: 3,
      resendIpLimit: 10,
      resendAccountLimit: 3,
      resetRequestIpLimit: 10,
      resetRequestAccountLimit: 3,
      requestWindowMs: 3_600_000,
      resendCooldownMs: 60_000,
    },
  )
  return { limiter, execute }
}

describe('RedisPublicAuthRateLimiter', () => {
  it('uses versioned HMAC-only IP/account/cooldown keys and exact operation limits', async () => {
    const { limiter, execute } = harness()

    await expect(
      limiter.consume({
        operation: 'email-verification-resend',
        ipAddress: '192.0.2.1',
        normalizedEmail: 'user@example.com',
      }),
    ).resolves.toEqual({ allowed: true })
    const operation = execute.mock.calls.find(([name]) =>
      String(name).startsWith('script:'),
    )
    expect(operation?.[1]).toBeDefined()
    const sendCommand = jest.fn(
      (command: readonly string[]): Promise<unknown> =>
        Promise.resolve(command[0] === 'SCRIPT' ? 'a'.repeat(40) : [1, 0]),
    )
    const client = {
      sendCommand: <T>(command: readonly string[]): Promise<T> =>
        sendCommand(command) as Promise<T>,
    } as RedisManagedClient
    const secondExecute = jest.fn() as jest.MockedFunction<
      RedisCommandExecutorPort['execute']
    >
    secondExecute.mockImplementation((_name, operation) => operation(client))
    const second = new RedisPublicAuthRateLimiter(
      { execute: secondExecute },
      new NodeAccountLifecycleCryptoAdapter(() => Buffer.alloc(32, 9)),
      {
        keyPrefix: 'nest-js-starter',
        environment: 'test',
        hmacSecret: Buffer.alloc(32, 1),
        registrationIpLimit: 10,
        registrationAccountLimit: 3,
        resendIpLimit: 10,
        resendAccountLimit: 3,
        resetRequestIpLimit: 10,
        resetRequestAccountLimit: 3,
        requestWindowMs: 3_600_000,
        resendCooldownMs: 60_000,
      },
    )
    await second.consume({
      operation: 'password-reset-request',
      ipAddress: '192.0.2.1',
      normalizedEmail: 'user@example.com',
    })
    const command = sendCommand.mock.calls.at(-1)?.[0]
    expect(command).toBeDefined()
    if (command === undefined) throw new Error('Missing EVALSHA command')
    expect(command[0]).toBe('EVALSHA')
    expect(command).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^nest-js-starter:test:auth:public:v1:password-reset-request:ip:/u,
        ),
        expect.stringMatching(
          /^nest-js-starter:test:auth:public:v1:password-reset-request:account:/u,
        ),
        expect.stringMatching(
          /^nest-js-starter:test:auth:public:v1:password-reset-request:cooldown:/u,
        ),
      ]),
    )
    expect(command.join(':')).not.toContain('user@example.com')
    expect(command.join(':')).not.toContain('192.0.2.1')
  })

  it('returns a bounded denial without changing the existing login limiter implementation', async () => {
    const { limiter } = harness([0, 2_000])
    await expect(
      limiter.consume({
        operation: 'register',
        ipAddress: '192.0.2.1',
        normalizedEmail: 'user@example.com',
      }),
    ).resolves.toEqual({ allowed: false, retryAfterMs: 2_000 })
  })
})
