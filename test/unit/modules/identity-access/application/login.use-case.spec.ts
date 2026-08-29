import type { AuthAuditPort } from '@/modules/identity-access/public-contracts/auth-audit.port'
import { AuthDependencyUnavailableError } from '@/modules/identity-access/public-contracts/auth-errors'
import { EmailVerificationRequiredError } from '@/modules/identity-access/public-contracts/auth-errors'
import { LoginUseCase } from '@/modules/identity-access/authentication/application/login.use-case'
import type { LoginRateLimiterPort } from '@/modules/identity-access/authentication/application/login-rate-limiter.port'
import type { PasswordCredentialPort } from '@/modules/identity-access/authentication/application/password-credential.port'
import type { PasswordHasherPort } from '@/modules/identity-access/authentication/application/password-hasher.port'
import type { SessionIssuer } from '@/modules/identity-access/sessions/application/session-issuer'

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
  readonly credentialFence: jest.Mock
  readonly audit: jest.Mocked<AuthAuditPort>
} {
  const credentialFence = jest.fn(
    (
      _userId: string,
      operation: (current: typeof snapshot) => Promise<unknown>,
    ): Promise<unknown> => operation(snapshot),
  )
  const credentials = {
    findCredentialByNormalizedEmail: jest.fn(() => Promise.resolve(snapshot)),
    withinCredentialVersionFence: credentialFence,
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
    credentialFence,
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
    expect(missing.passwords.verify).toHaveBeenCalledTimes(1)
    expect(missing.passwords.verify).toHaveBeenCalledWith(
      'password',
      '$argon2id$constant-dummy',
    )
    for (const target of [wrongPassword, disabled]) {
      expect(target.passwords.verify).toHaveBeenCalledTimes(1)
      expect(target.passwords.verify).toHaveBeenCalledWith(
        'password',
        'stored-hash',
      )
    }
    for (const target of [missing, wrongPassword, disabled]) {
      expect(target.passwords.hash).not.toHaveBeenCalled()
      expect(target.sessions.issue).not.toHaveBeenCalled()
    }
  })
  it('normalizes email and issues through the credential version fence', async () => {
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
    expect(target.sessions.issue).toHaveBeenCalledWith({
      userId: 'user',
      nowMs: 1_000,
      deviceLabel: 'browser',
      networkFingerprint: 'network',
    })
    expect(target.credentialFence).toHaveBeenCalledWith(
      'user',
      expect.any(Function),
    )
  })

  it('rejects an old password when the credential changes before issuance', async () => {
    const initialSnapshot = {
      userId: 'user',
      status: 'active' as const,
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      passwordHash: 'old-hash',
      passwordVersion: 2,
    }
    const target = harness(initialSnapshot)
    target.credentialFence.mockImplementation(
      (
        _userId,
        operation: (current: typeof initialSnapshot) => Promise<unknown>,
      ) =>
        operation({
          ...initialSnapshot,
          passwordHash: 'new-hash',
          passwordVersion: 3,
        }),
    )
    jest
      .mocked(target.passwords.verify)
      .mockResolvedValueOnce({ matches: true, needsRehash: false })
      .mockResolvedValueOnce({ matches: false, needsRehash: false })

    await expect(
      target.useCase.execute({
        email: 'user@example.com',
        password: 'old-password',
        ipAddress: '192.0.2.1',
        nowMs: 1_000,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect(target.passwords.verify).toHaveBeenNthCalledWith(
      2,
      'old-password',
      'new-hash',
    )
    expect(target.sessions.issue).not.toHaveBeenCalled()
    expect(target.audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'INVALID_CREDENTIALS' }),
    )
  })

  it('accepts the same password after a concurrent opportunistic rehash', async () => {
    const initialSnapshot = {
      userId: 'user',
      status: 'active' as const,
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      passwordHash: 'old-hash',
      passwordVersion: 2,
    }
    const target = harness(initialSnapshot)
    target.credentialFence.mockImplementation(
      (
        _userId,
        operation: (current: typeof initialSnapshot) => Promise<unknown>,
      ) =>
        operation({
          ...initialSnapshot,
          passwordHash: 'rehash',
          passwordVersion: 3,
        }),
    )
    jest
      .mocked(target.passwords.verify)
      .mockResolvedValueOnce({ matches: true, needsRehash: true })
      .mockResolvedValueOnce({ matches: true, needsRehash: false })

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
    expect(target.credentials.replacePasswordIfVersion).not.toHaveBeenCalled()
    expect(target.sessions.issue).toHaveBeenCalledTimes(1)
  })

  it('fails closed when a fenced opportunistic rehash loses its CAS', async () => {
    const target = harness({
      userId: 'user',
      status: 'active',
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      passwordHash: 'old-hash',
      passwordVersion: 2,
    })
    jest
      .mocked(target.passwords.verify)
      .mockResolvedValue({ matches: true, needsRehash: true })
    jest
      .mocked(target.credentials.replacePasswordIfVersion)
      .mockResolvedValue(false)

    await expect(
      target.useCase.execute({
        email: 'user@example.com',
        password: 'password',
        ipAddress: '192.0.2.1',
        nowMs: 1_000,
        deviceLabel: 'browser',
        networkFingerprint: 'network',
      }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect(target.sessions.issue).not.toHaveBeenCalled()
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
