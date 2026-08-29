import type { AuthAuditEvent } from '@/modules/auth/application/auth-audit.port'
import {
  AuthMailDeliveryError,
  type AuthMailDeliveryPort,
} from '@/modules/auth/application/auth-mail-delivery.port'
import type { EmailVerificationPersistencePort } from '@/modules/auth/application/email-verification-persistence.port'
import type { PasswordRecoveryPersistencePort } from '@/modules/auth/application/password-recovery-persistence.port'
import type { RegistrationPersistencePort } from '@/modules/auth/application/registration-persistence.port'
import { AuthRateLimitedError } from '@/modules/auth/application/auth-errors'
import { ConfirmEmailVerificationUseCase } from '@/modules/auth/application/confirm-email-verification.use-case'
import { ConfirmPasswordResetUseCase } from '@/modules/auth/application/confirm-password-reset.use-case'
import { RegisterUserUseCase } from '@/modules/auth/application/register-user.use-case'
import { RequestPasswordResetUseCase } from '@/modules/auth/application/request-password-reset.use-case'
import type { OneTimeTokenCodecPort } from '@/modules/auth/application/one-time-token-codec.port'
import type { PublicAuthRateLimiterPort } from '@/modules/auth/application/public-auth-rate-limiter.port'
import { SelfServiceAuthPolicy } from '@/modules/auth/application/self-service-auth.policy'
import type { PasswordHasherPort } from '@/modules/auth/application/password-hasher.port'
import type { SessionStorePort } from '@/modules/auth/application/session-store.port'
import type { AuthSessionCleanupObserver } from '@/modules/auth/application/auth.types'

type SelfServicePersistencePort = RegistrationPersistencePort &
  EmailVerificationPersistencePort &
  PasswordRecoveryPersistencePort

const now = new Date('2026-08-06T00:00:00.000Z')
const policy = new SelfServiceAuthPolicy({
  mode: 'open',
  publicAppUrl: 'https://app.example.com',
  verificationTtlMs: 86_400_000,
  passwordResetTtlMs: 1_800_000,
})

function codec(): OneTimeTokenCodecPort {
  return {
    issue: jest.fn(() => ({ rawToken: 'raw-token', digest: 'digest' })),
    digest: jest.fn((value) =>
      value === 'valid-token' ? 'digest' : undefined,
    ),
  }
}

function limiter(
  decision: Awaited<ReturnType<PublicAuthRateLimiterPort['consume']>> = {
    allowed: true,
  },
): PublicAuthRateLimiterPort {
  return { consume: jest.fn(() => Promise.resolve(decision)) }
}

function mail(
  delivery: AuthMailDeliveryPort = {
    sendEmailVerification: jest.fn(() => Promise.resolve({ delivered: true })),
    sendPasswordReset: jest.fn(() => Promise.resolve({ delivered: true })),
    sendAccountInvitation: jest.fn(() => Promise.resolve({ delivered: true })),
  },
): AuthMailDeliveryPort {
  return delivery
}

function passwords(): jest.Mocked<PasswordHasherPort> {
  return {
    hash: jest.fn((password: string) => {
      void password
      return Promise.resolve('password-hash')
    }),
    verify: jest.fn((password: string, encodedHash: string) => {
      void password
      void encodedHash
      return Promise.resolve({ matches: true, needsRehash: false })
    }),
  }
}

function audit(): {
  readonly events: AuthAuditEvent[]
  readonly emit: jest.Mock
} {
  const events: AuthAuditEvent[] = []
  return {
    events,
    emit: jest.fn((event: AuthAuditEvent) => events.push(event)),
  }
}

describe('self-service account lifecycle use cases', () => {
  it('does not consume a limiter or hash when self-service is disabled', async () => {
    const disabledPolicy = new SelfServiceAuthPolicy({
      ...policy.settings,
      mode: 'disabled',
    })
    const consume = jest.fn(() => Promise.resolve({ allowed: true as const }))
    const publicLimiter: PublicAuthRateLimiterPort = { consume }
    const target = new RegisterUserUseCase(
      {} as SelfServicePersistencePort,
      passwords(),
      publicLimiter,
      codec(),
      mail(),
      disabledPolicy,
    )

    await expect(
      target.execute({
        email: 'user@example.com',
        password: 'a sufficiently long password',
        ipAddress: '192.0.2.1',
        now,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_SESSION_NOT_FOUND' })
    expect(consume).not.toHaveBeenCalled()
  })

  it('registers an account, applies the verification TTL and keeps mail failure best effort', async () => {
    const events = audit()
    const password = passwords()
    const delivery = mail({
      sendEmailVerification: jest.fn(() =>
        Promise.reject(new AuthMailDeliveryError()),
      ),
      sendPasswordReset: jest.fn(),
      sendAccountInvitation: jest.fn(),
    })
    const registerSelfServiceUser = jest.fn(
      (
        input: Parameters<
          RegistrationPersistencePort['registerSelfServiceUser']
        >[0],
      ) => {
        void input
        return Promise.resolve({
          created: true as const,
          userId: 'user-1',
          email: 'User@Example.com',
        })
      },
    )
    const target = new RegisterUserUseCase(
      { registerSelfServiceUser },
      password,
      limiter(),
      codec(),
      delivery,
      policy,
      { emit: events.emit },
    )

    await expect(
      target.execute({
        email: ' User@Example.com ',
        password: 'a sufficiently long password',
        ipAddress: '192.0.2.1',
        now,
      }),
    ).resolves.toBeUndefined()
    expect(password.hash.mock.calls).toEqual([['a sufficiently long password']])
    expect(registerSelfServiceUser.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        email: 'User@Example.com',
        normalizedEmail: 'user@example.com',
        passwordHash: 'password-hash',
        tokenDigest: 'digest',
        createdAt: now,
        expiresAt: new Date('2026-08-07T00:00:00.000Z'),
      }),
    )
    expect(events.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'registration', outcome: 'success' }),
        expect.objectContaining({
          action: 'email_verification_send',
          outcome: 'partial',
          reasonCode: 'MAIL_DELIVERY_FAILED',
        }),
      ]),
    )
  })

  it('returns the duplicate registration outcome without sending mail', async () => {
    const delivery = mail()
    const target = new RegisterUserUseCase(
      {
        registerSelfServiceUser: jest.fn(() =>
          Promise.resolve({ created: false as const }),
        ),
      },
      passwords(),
      limiter(),
      codec(),
      delivery,
      policy,
    )

    await expect(
      target.execute({
        email: 'user@example.com',
        password: 'password',
        ipAddress: '192.0.2.1',
        now,
      }),
    ).resolves.toBeUndefined()
    expect(
      (delivery.sendEmailVerification as jest.Mock).mock.calls,
    ).toHaveLength(0)
  })

  it('preserves rate-limit denial before persistence and password hashing', async () => {
    const publicLimiter = limiter({ allowed: false, retryAfterMs: 12_000 })
    const persistence = { rotatePasswordResetToken: jest.fn() }
    const target = new RequestPasswordResetUseCase(
      persistence as unknown as SelfServicePersistencePort,
      publicLimiter,
      codec(),
      mail(),
      policy,
    )

    await expect(
      target.execute({
        email: 'user@example.com',
        ipAddress: '192.0.2.1',
        now,
      }),
    ).rejects.toBeInstanceOf(AuthRateLimitedError)
    expect(persistence.rotatePasswordResetToken).not.toHaveBeenCalled()
  })

  it('confirms only canonical valid verification tokens and audits success', async () => {
    const events = audit()
    const confirmEmailVerification = jest.fn(() =>
      Promise.resolve({ userId: 'user-1', email: 'user@example.com' }),
    )
    const target = new ConfirmEmailVerificationUseCase(
      { confirmEmailVerification } as unknown as SelfServicePersistencePort,
      codec(),
      policy,
      { emit: events.emit },
    )

    await expect(
      target.execute({ token: 'valid-token', now }),
    ).resolves.toBeUndefined()
    expect(confirmEmailVerification.mock.calls).toEqual([['digest', now]])
    expect(events.events).toEqual([
      expect.objectContaining({
        action: 'email_verification_confirm',
        outcome: 'success',
      }),
    ])
  })

  it('does not hash a malformed reset token and invalidates Redis sessions after success', async () => {
    const password = passwords()
    const revokeAll = jest.fn(() => Promise.resolve(1))
    const getEligiblePasswordResetTokenSource = jest.fn(() =>
      Promise.resolve<'self-service'>('self-service'),
    )
    const confirmPasswordReset = jest.fn(() =>
      Promise.resolve({ userId: 'user-1', email: 'user@example.com' }),
    )
    const target = new ConfirmPasswordResetUseCase(
      {
        getEligiblePasswordResetTokenSource,
        confirmPasswordReset,
      } as unknown as SelfServicePersistencePort,
      password,
      codec(),
      policy,
      { revokeAll } as unknown as SessionStorePort,
    )

    await expect(
      target.execute({ token: 'malformed', newPassword: 'new password', now }),
    ).rejects.toMatchObject({
      code: 'AUTH_STATE_CONFLICT',
    })
    expect(password.hash.mock.calls).toHaveLength(0)
    expect(confirmPasswordReset).not.toHaveBeenCalled()

    await expect(
      target.execute({
        token: 'valid-token',
        newPassword: 'new password',
        now,
      }),
    ).resolves.toEqual({
      cleanupComplete: true,
    })
    expect(password.hash.mock.calls).toEqual([['new password']])
    expect(revokeAll.mock.calls).toEqual([['user-1']])
  })

  it.each(['missing', 'expired'])(
    'does not hash a canonical %s reset token when eligibility is false',
    async (state) => {
      const password = passwords()
      const getEligiblePasswordResetTokenSource = jest.fn(() =>
        Promise.resolve(undefined),
      )
      const confirmPasswordReset = jest.fn()
      const target = new ConfirmPasswordResetUseCase(
        {
          getEligiblePasswordResetTokenSource,
          confirmPasswordReset,
        } as unknown as SelfServicePersistencePort,
        password,
        codec(),
        policy,
        { revokeAll: jest.fn() } as unknown as SessionStorePort,
      )

      await expect(
        target.execute({
          token: 'valid-token',
          newPassword: `${state} password`,
          now,
        }),
      ).rejects.toMatchObject({ code: 'AUTH_STATE_CONFLICT' })
      expect(getEligiblePasswordResetTokenSource.mock.calls).toEqual([
        ['digest', now],
      ])
      expect(password.hash.mock.calls).toHaveLength(0)
      expect(confirmPasswordReset).not.toHaveBeenCalled()
    },
  )

  it('reports committed reset with incomplete Redis cleanup as partial', async () => {
    const events = audit()
    const observer: jest.Mocked<AuthSessionCleanupObserver> = {
      cleanupIncomplete: jest.fn(),
    }
    const target = new ConfirmPasswordResetUseCase(
      {
        getEligiblePasswordResetTokenSource: jest.fn(() =>
          Promise.resolve<'self-service'>('self-service'),
        ),
        confirmPasswordReset: jest.fn(() =>
          Promise.resolve({ userId: 'user-1', email: 'user@example.com' }),
        ),
      } as unknown as SelfServicePersistencePort,
      passwords(),
      codec(),
      policy,
      {
        revokeAll: jest.fn(() => Promise.reject(new Error('redis'))),
      } as unknown as SessionStorePort,
      observer,
      { emit: events.emit },
    )

    await expect(
      target.execute({
        token: 'valid-token',
        newPassword: 'new password',
        now,
      }),
    ).resolves.toEqual({
      cleanupComplete: false,
    })
    expect(observer.cleanupIncomplete.mock.calls).toEqual([
      ['password-reset', 'user-1'],
    ])
    expect(events.events).toEqual([
      expect.objectContaining({
        action: 'password_reset_confirm',
        outcome: 'partial',
        reasonCode: 'CLEANUP_INCOMPLETE',
      }),
    ])
  })

  it('rejects an administrator reset token when only self-service is enabled', async () => {
    const password = passwords()
    const confirmPasswordReset = jest.fn()
    const target = new ConfirmPasswordResetUseCase(
      {
        getEligiblePasswordResetTokenSource: jest.fn(() =>
          Promise.resolve<'administrator'>('administrator'),
        ),
        confirmPasswordReset,
      } as unknown as SelfServicePersistencePort,
      password,
      codec(),
      policy,
      { revokeAll: jest.fn() } as unknown as SessionStorePort,
    )

    await expect(
      target.execute({
        token: 'valid-token',
        newPassword: 'new password',
        now,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_STATE_CONFLICT' })
    expect(password.hash.mock.calls).toHaveLength(0)
    expect(confirmPasswordReset).not.toHaveBeenCalled()
  })

  it('accepts only administrator reset tokens when only account email workflows are enabled', async () => {
    const administratorOnlyPolicy = new SelfServiceAuthPolicy({
      mode: 'disabled',
      emailWorkflowsEnabled: true,
      verificationTtlMs: 86_400_000,
      passwordResetTtlMs: 1_800_000,
    })
    const confirmPasswordReset = jest.fn(() =>
      Promise.resolve({ userId: 'user-1', email: 'user@example.com' }),
    )
    const target = new ConfirmPasswordResetUseCase(
      {
        getEligiblePasswordResetTokenSource: jest.fn(() =>
          Promise.resolve<'administrator'>('administrator'),
        ),
        confirmPasswordReset,
      } as unknown as SelfServicePersistencePort,
      passwords(),
      codec(),
      administratorOnlyPolicy,
      {
        revokeAll: jest.fn(() => Promise.resolve(1)),
      } as unknown as SessionStorePort,
    )

    await expect(
      target.execute({
        token: 'valid-token',
        newPassword: 'new password',
        now,
      }),
    ).resolves.toEqual({ cleanupComplete: true })
    expect(confirmPasswordReset).toHaveBeenCalledWith({
      tokenDigest: 'digest',
      source: 'administrator',
      now,
      passwordHash: 'password-hash',
    })
  })
})
