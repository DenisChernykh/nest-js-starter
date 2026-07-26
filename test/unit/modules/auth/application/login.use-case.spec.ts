import type { AuthAuditPort } from '@/modules/auth/application/auth-audit.port'
import type { AuthPersistencePort } from '@/modules/auth/application/auth-persistence.port'
import { AuthDependencyUnavailableError } from '@/modules/auth/application/auth-errors'
import { LoginUseCase } from '@/modules/auth/application/login.use-case'
import type { LoginRateLimiterPort } from '@/modules/auth/application/login-rate-limiter.port'
import type { PasswordHasherPort } from '@/modules/auth/application/password-hasher.port'
import type { SessionStorePort } from '@/modules/auth/application/session-store.port'

/* eslint-disable @typescript-eslint/unbound-method */

function harness(
  snapshot: Awaited<
    ReturnType<AuthPersistencePort['findCredentialByNormalizedEmail']>
  >,
): {
  readonly useCase: LoginUseCase
  readonly persistence: AuthPersistencePort
  readonly passwords: PasswordHasherPort
  readonly limiter: LoginRateLimiterPort
  readonly sessions: SessionStorePort
  readonly audit: jest.Mocked<AuthAuditPort>
} {
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
  const audit = { emit: jest.fn() } as jest.Mocked<AuthAuditPort>
  return {
    useCase: new LoginUseCase(
      persistence,
      passwords,
      limiter,
      sessions,
      '$argon2id$constant-dummy',
      audit,
    ),
    persistence,
    passwords,
    limiter,
    sessions,
    audit,
  }
}

describe('LoginUseCase', () => {
  it('uses the dummy hash and generic failure for a missing account', async () => {
    const target = harness(undefined)
    await expect(
      target.useCase.execute({
        email: ' User@Example.com ',
        password: 'password',
        ipAddress: '192.0.2.1',
        nowMs: 1_000,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect(target.passwords.verify).toHaveBeenCalledWith(
      'password',
      '$argon2id$constant-dummy',
    )
    expect(target.audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'INVALID_CREDENTIALS' }),
    )
  })
  it('normalizes email and issues from durable generation and epoch', async () => {
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
    expect(target.limiter.consume).toHaveBeenCalledWith({
      ipAddress: '192.0.2.1',
      normalizedEmail: 'user@example.com',
    })
    expect(target.sessions.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionGeneration: 4n,
        globalSessionEpoch: 5n,
      }),
    )
  })
  it('denies before credential lookup when the distributed limiter rejects', async () => {
    const target = harness(undefined)
    jest
      .mocked(target.limiter.consume)
      .mockResolvedValue({ allowed: false, retryAfterMs: 500 })
    await expect(
      target.useCase.execute({
        email: 'user@example.com',
        password: 'password',
        ipAddress: '192.0.2.1',
        nowMs: 1_000,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).rejects.toMatchObject({ code: 'AUTH_RATE_LIMITED', retryAfterMs: 500 })
    expect(
      target.persistence.findCredentialByNormalizedEmail,
    ).not.toHaveBeenCalled()
  })
  it('maps unexpected dependency failures to the stable auth error', async () => {
    const target = harness(undefined)
    jest
      .mocked(target.limiter.consume)
      .mockRejectedValue(new Error('driver detail'))
    await expect(
      target.useCase.execute({
        email: 'user@example.com',
        password: 'password',
        ipAddress: '192.0.2.1',
        nowMs: 1_000,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).rejects.toBeInstanceOf(AuthDependencyUnavailableError)
  })
})
