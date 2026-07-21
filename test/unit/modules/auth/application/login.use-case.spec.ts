import type { AuthPersistencePort } from '@/modules/auth/application/auth-persistence.port'
import { AuthDependencyUnavailableError } from '@/modules/auth/application/auth-errors'
import { LoginUseCase } from '@/modules/auth/application/login.use-case'
import type { LoginRateLimiterPort } from '@/modules/auth/application/login-rate-limiter.port'
import type { PasswordHasherPort } from '@/modules/auth/application/password-hasher.port'
import type { SessionStorePort } from '@/modules/auth/application/session-store.port'
import type { AuthAuditPort } from '@/modules/auth/application/auth-audit.port'
import type { TelemetryPort } from '@/shared/application/telemetry.port'

interface LoginHarness {
  readonly useCase: LoginUseCase
  readonly persistence: AuthPersistencePort
  readonly passwords: PasswordHasherPort
  readonly limiter: LoginRateLimiterPort
  readonly sessions: SessionStorePort
  readonly audit: jest.Mocked<AuthAuditPort>
  readonly telemetry: jest.Mocked<TelemetryPort>
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
    const audit = { emit: jest.fn() }
    const telemetry = {
      runAuthOperation: jest.fn((_operation, work) => work()),
      recordAuthOutcome: jest.fn(),
    } as jest.Mocked<TelemetryPort>
    return {
      useCase: new LoginUseCase(
        persistence,
        passwords,
        limiter,
        sessions,
        '$argon2id$constant-dummy',
        audit,
        telemetry,
      ),
      persistence,
      passwords,
      limiter,
      sessions,
      audit,
      telemetry,
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
    expect(target.audit.emit.mock.calls).toContainEqual([
      {
        action: 'login',
        outcome: 'denied',
        reasonCode: 'INVALID_CREDENTIALS',
      },
    ])
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.telemetry.recordAuthOutcome).toHaveBeenCalledWith(
      'login',
      'denied',
    )
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.telemetry.runAuthOperation).toHaveBeenCalledWith(
      'login',
      expect.any(Function),
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
    expect(target.audit.emit.mock.calls).toContainEqual([
      {
        action: 'login',
        outcome: 'success',
        reasonCode: 'LOGIN_SUCCEEDED',
        actorId: 'user',
        sessionId: 'public',
        targetType: 'session',
        targetId: 'public',
      },
    ])
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.telemetry.recordAuthOutcome).toHaveBeenCalledWith(
      'login',
      'success',
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
    expect(target.audit.emit.mock.calls).toContainEqual([
      {
        action: 'login',
        outcome: 'denied',
        reasonCode: 'RATE_LIMITED',
      },
    ])
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.telemetry.recordAuthOutcome).toHaveBeenCalledWith(
      'login',
      'rate_limited',
    )
  })

  it('preserves a typed dependency failure and records its finite outcome', async () => {
    const target = harness(undefined)
    const dependencyError = new AuthDependencyUnavailableError()
    // eslint-disable-next-line @typescript-eslint/unbound-method
    jest.mocked(target.limiter.consume).mockRejectedValue(dependencyError)

    await expect(
      target.useCase.execute({
        email: 'user@example.com',
        password: 'password',
        ipAddress: '192.0.2.1',
        nowMs: 1_000,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).rejects.toBe(dependencyError)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.audit.emit).toHaveBeenCalledWith({
      action: 'login',
      outcome: 'denied',
      reasonCode: 'DEPENDENCY_UNAVAILABLE',
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.telemetry.recordAuthOutcome).toHaveBeenCalledWith(
      'login',
      'dependency_error',
    )
  })

  it('normalizes an unknown dependency failure without retaining its detail', async () => {
    const target = harness(undefined)
    jest
      .mocked(target.limiter)
      .consume.mockRejectedValue(new Error('private redis detail'))

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
      code: 'AUTH_DEPENDENCY_UNAVAILABLE',
      message: 'Authentication dependency unavailable',
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.audit.emit).toHaveBeenCalledWith({
      action: 'login',
      outcome: 'denied',
      reasonCode: 'DEPENDENCY_UNAVAILABLE',
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(target.telemetry.recordAuthOutcome).toHaveBeenCalledWith(
      'login',
      'dependency_error',
    )
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
