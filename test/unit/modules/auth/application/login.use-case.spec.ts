import type { AuthAuditPort } from '@/modules/auth/application/auth-audit.port'
import { AuthDependencyUnavailableError } from '@/modules/auth/application/auth-errors'
import { EmailVerificationRequiredError } from '@/modules/auth/application/auth-errors'
import { LoginUseCase } from '@/modules/auth/authentication/application/login.use-case'
import type { LoginRateLimiterPort } from '@/modules/auth/authentication/application/login-rate-limiter.port'
import type { PasswordCredentialPort } from '@/modules/auth/authentication/application/password-credential.port'
import type { PasswordHasherPort } from '@/modules/auth/authentication/application/password-hasher.port'
import type { SessionIssuer } from '@/modules/auth/sessions/application/session-issuer'

/* eslint-disable @typescript-eslint/unbound-method */

function harness(
  snapshot: Awaited<
    ReturnType<PasswordCredentialPort['findCredentialByNormalizedEmail']>
  >,
): {
  readonly useCase: LoginUseCase
  readonly credentials: PasswordCredentialPort
  readonly passwords: PasswordHasherPort
  readonly limiter: LoginRateLimiterPort
  readonly sessions: jest.Mocked<Pick<SessionIssuer, 'issue'>>
  readonly audit: jest.Mocked<AuthAuditPort>
} {
  const credentials = {
    findCredentialByNormalizedEmail: jest.fn(() => Promise.resolve(snapshot)),
    replacePasswordIfVersion: jest.fn(() => Promise.resolve(true)),
  } as unknown as PasswordCredentialPort
  const passwords = {
    verify: jest.fn(() =>
      Promise.resolve({ matches: true, needsRehash: false }),
    ),
    hash: jest.fn(() => Promise.resolve('new-hash')),
  } as unknown as PasswordHasherPort
  const limiter = {
    consume: jest.fn(() => Promise.resolve({ allowed: true as const })),
  } as unknown as LoginRateLimiterPort
  const sessions: jest.Mocked<Pick<SessionIssuer, 'issue'>> = {
    issue: jest
      .fn<
        ReturnType<SessionIssuer['issue']>,
        Parameters<SessionIssuer['issue']>
      >()
      .mockResolvedValue({
        rawToken: 'raw',
        publicId: 'public',
        csrfToken: 'csrf',
        absoluteExpiresAt: new Date(10_000),
      }),
  }
  const audit = { emit: jest.fn() } as jest.Mocked<AuthAuditPort>
  return {
    useCase: new LoginUseCase(
      credentials,
      passwords,
      limiter,
      sessions as unknown as SessionIssuer,
      '$argon2id$constant-dummy',
      audit,
    ),
    credentials,
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
  it('keeps missing, wrong-password and disabled failures indistinguishable', async () => {
    const activeSnapshot = {
      userId: 'user',
      status: 'active' as const,
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      passwordHash: 'stored-hash',
      passwordVersion: 0,
    }
    const missing = harness(undefined)
    const wrongPassword = harness(activeSnapshot)
    jest
      .mocked(wrongPassword.passwords.verify)
      .mockResolvedValue({ matches: false, needsRehash: false })
    const disabled = harness({ ...activeSnapshot, status: 'disabled' })
    const login = {
      email: 'user@example.com',
      password: 'password',
      ipAddress: '192.0.2.1',
      nowMs: 1_000,
      deviceLabel: 'browser',
      networkFingerprint: 'network',
    }

    const errors = await Promise.all(
      [missing, wrongPassword, disabled].map(async (target) => {
        try {
          await target.useCase.execute(login)
          throw new Error('Expected login to fail')
        } catch (error: unknown) {
          expect(target.sessions.issue).not.toHaveBeenCalled()
          return error
        }
      }),
    )

    expect(errors).toEqual([
      expect.objectContaining({ code: 'AUTHENTICATION_FAILED' }),
      expect.objectContaining({ code: 'AUTHENTICATION_FAILED' }),
      expect.objectContaining({ code: 'AUTHENTICATION_FAILED' }),
    ])
  })
  it('normalizes email and issues from durable generation and epoch', async () => {
    const target = harness({
      userId: 'user',
      status: 'active',
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      passwordHash: 'stored-hash',
      passwordVersion: 2,
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
        userId: 'user',
        nowMs: 1_000,
      }),
    )
  })

  it('requires verification after a correct password without rehash or session issuance', async () => {
    const target = harness({
      userId: 'unverified-user',
      status: 'active',
      emailVerifiedAt: undefined,
      passwordHash: 'stored-hash',
      passwordVersion: 0,
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
    ).rejects.toBeInstanceOf(EmailVerificationRequiredError)
    expect(target.passwords.hash).not.toHaveBeenCalled()
    expect(target.sessions.issue).not.toHaveBeenCalled()
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
      target.credentials.findCredentialByNormalizedEmail,
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
