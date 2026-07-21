import type { AuthPersistencePort } from '@/modules/auth/application/auth-persistence.port'
import { LoginUseCase } from '@/modules/auth/application/login.use-case'
import type { LoginRateLimiterPort } from '@/modules/auth/application/login-rate-limiter.port'
import type { PasswordHasherPort } from '@/modules/auth/application/password-hasher.port'
import type { SessionStorePort } from '@/modules/auth/application/session-store.port'

interface LoginHarness {
  readonly useCase: LoginUseCase
  readonly persistence: AuthPersistencePort
  readonly passwords: PasswordHasherPort
  readonly limiter: LoginRateLimiterPort
  readonly sessions: SessionStorePort
}

describe('LoginUseCase', () => {
  function harness(
    snapshot: Awaited<
      ReturnType<AuthPersistencePort['findCredentialByNormalizedEmail']>
    >,
  ): LoginHarness {
    const persistence = {
      findCredentialByNormalizedEmail: jest.fn(() => Promise.resolve(snapshot)),
      readGlobalSessionEpoch: jest.fn(() => Promise.resolve(5n)),
    } as unknown as AuthPersistencePort
    const passwords = {
      verify: jest.fn(() =>
        Promise.resolve({ matches: true, needsRehash: false }),
      ),
      hash: jest.fn(() => Promise.resolve('new-hash')),
    } as unknown as PasswordHasherPort
    const limiter = {
      consume: jest.fn(() => Promise.resolve({ allowed: true as const })),
    } as unknown as LoginRateLimiterPort
    const sessions = {
      issue: jest.fn(() =>
        Promise.resolve({
          rawToken: 'raw',
          publicId: 'public',
          csrfToken: 'csrf',
          absoluteExpiresAt: new Date(10_000),
        }),
      ),
    } as unknown as SessionStorePort
    return {
      useCase: new LoginUseCase(
        persistence,
        passwords,
        limiter,
        sessions,
        '$argon2id$constant-dummy',
      ),
      persistence,
      passwords,
      limiter,
      sessions,
    }
  }

  it.each([
    ['missing account', undefined, true],
    [
      'wrong password',
      {
        userId: 'user',
        email: 'User@Example.com',
        normalizedEmail: 'user@example.com',
        status: 'active' as const,
        sessionGeneration: 0n,
        passwordHash: 'stored-hash',
        passwordVersion: 0,
        roleKeys: [],
      },
      false,
    ],
  ])('returns generic failure for %s', async (_name, snapshot, missing) => {
    const target = harness(snapshot)
    if (!missing)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      jest.mocked(target.passwords.verify).mockResolvedValue({
        matches: false,
        needsRehash: false,
      })

    await expect(
      target.useCase.execute({
        email: ' User@Example.com ',
        password: 'unchanged password',
        ipAddress: '192.0.2.1',
        nowMs: 1_000,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.passwords.verify).toHaveBeenCalledWith(
      'unchanged password',
      missing ? '$argon2id$constant-dummy' : 'stored-hash',
    )
  })

  it('normalizes only email and issues from durable generation and epoch', async () => {
    const target = harness({
      userId: 'user',
      email: 'User@Example.com',
      normalizedEmail: 'user@example.com',
      status: 'active',
      sessionGeneration: 4n,
      passwordHash: 'stored-hash',
      passwordVersion: 2,
      roleKeys: [],
    })

    await expect(
      target.useCase.execute({
        email: ' User@Example.com ',
        password: 'password',
        ipAddress: '192.0.2.1',
        nowMs: 1_000,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).resolves.toMatchObject({ publicId: 'public' })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.limiter.consume).toHaveBeenCalledWith({
      ipAddress: '192.0.2.1',
      normalizedEmail: 'user@example.com',
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.sessions.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user',
        sessionGeneration: 4n,
        globalSessionEpoch: 5n,
      }),
    )
  })

  it('denies before credential lookup when either distributed bucket is over limit', async () => {
    const target = harness(undefined)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    jest.mocked(target.limiter.consume).mockResolvedValue({
      allowed: false,
      retryAfterMs: 500,
    })

    await expect(
      target.useCase.execute({
        email: 'user@example.com',
        password: 'password',
        ipAddress: '192.0.2.1',
        nowMs: 1_000,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_RATE_LIMITED',
      retryAfterMs: 500,
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const findCredential = target.persistence.findCredentialByNormalizedEmail
    expect(findCredential).not.toHaveBeenCalled()
  })

  it('uses best-effort rehash CAS without rejecting a verified login conflict', async () => {
    const target = harness({
      userId: 'user',
      email: 'user@example.com',
      normalizedEmail: 'user@example.com',
      status: 'active',
      sessionGeneration: 1n,
      passwordHash: 'weaker-hash',
      passwordVersion: 4,
      roleKeys: [],
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    jest.mocked(target.passwords.verify).mockResolvedValue({
      matches: true,
      needsRehash: true,
    })
    target.persistence.replacePasswordIfVersion = jest.fn(() =>
      Promise.resolve(false),
    )

    await expect(
      target.useCase.execute({
        email: 'user@example.com',
        password: 'password',
        ipAddress: '192.0.2.1',
        nowMs: 1_000,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).resolves.toMatchObject({ publicId: 'public' })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.persistence.replacePasswordIfVersion).toHaveBeenCalledWith(
      'user',
      4,
      'new-hash',
    )
  })
})
