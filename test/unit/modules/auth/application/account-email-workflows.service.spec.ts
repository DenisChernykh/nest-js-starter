import type {
  AuthAuditEvent,
  AuthAuditPort,
} from '@/modules/auth/application/auth-audit.port'
import { AccountEmailWorkflowsPolicy } from '@/modules/auth/application/account-email-workflows.policy'
import { AccountEmailWorkflowsService } from '@/modules/auth/application/account-email-workflows.service'
import {
  AuthMailDeliveryError,
  type AuthMailDeliveryPort,
} from '@/modules/auth/application/auth-mail-delivery.port'
import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthRateLimitedError,
} from '@/modules/auth/application/auth-errors'
import type { OneTimeTokenCodecPort } from '@/modules/auth/application/one-time-token-codec.port'
import type { InvitationPersistencePort } from '@/modules/auth/application/invitation-persistence.port'
import type { PasswordRecoveryPersistencePort } from '@/modules/auth/application/password-recovery-persistence.port'
import type { PasswordHasherPort } from '@/modules/auth/authentication/application/password-hasher.port'
import type { PublicAuthRateLimiterPort } from '@/modules/auth/application/public-auth-rate-limiter.port'
import {
  AUTH_ACCOUNTS_MANAGE_PERMISSION,
  AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
  RoleRegistry,
} from '@/modules/auth/authorization/application/role-registry'
import { AuthTokenInvalidOrExpiredError } from '@/modules/auth/application/self-service-auth.policy'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'
import type { StructuredLogRecord } from '@/platform/logging/logging.contracts'

const now = new Date('2026-08-07T12:00:00.000Z')

type AccountEmailWorkflowsPersistence = InvitationPersistencePort &
  PasswordRecoveryPersistencePort

function service(input: {
  readonly persistence: AccountEmailWorkflowsPersistence
  readonly mail: AuthMailDeliveryPort
  readonly passwords?: PasswordHasherPort
  readonly limiter?: PublicAuthRateLimiterPort
  readonly audit?: AuthAuditPort
}): AccountEmailWorkflowsService {
  const codec: OneTimeTokenCodecPort = {
    issue: () => ({ rawToken: 'raw-token', digest: 'digest' }),
    digest: (token) => (token === 'raw-token' ? 'digest' : undefined),
  }
  const passwords: PasswordHasherPort = input.passwords ?? {
    hash: () => Promise.resolve('password-hash'),
    verify: () => Promise.resolve({ matches: false, needsRehash: false }),
  }
  return new AccountEmailWorkflowsService(
    input.persistence,
    input.persistence,
    codec,
    passwords,
    input.mail,
    new AccountEmailWorkflowsPolicy({
      mode: 'enabled',
      invitationTtlMs: 86_400_000,
      passwordResetTtlMs: 900_000,
      publicAppUrl: 'https://app.example.com',
    }),
    new RoleRegistry([
      {
        key: 'system.admin',
        permissions: [
          AUTH_ACCOUNTS_MANAGE_PERMISSION,
          AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
        ],
      },
    ]),
    input.limiter ?? {
      consume: () => Promise.resolve({ allowed: true }),
    },
    input.audit,
  )
}

describe('AccountEmailWorkflowsService', () => {
  it('uses the reviewed administrator reset-token lifetime', async () => {
    const rotateAdministratorPasswordReset = jest.fn(
      (
        _input: Parameters<
          PasswordRecoveryPersistencePort['rotateAdministratorPasswordReset']
        >[0],
      ) => {
        void _input
        return Promise.resolve({
          userId: '95ee8d48-2f19-49be-af21-c5f471c1e502',
          email: 'target@example.com',
        })
      },
    )
    const target = service({
      persistence: {
        rotateAdministratorPasswordReset,
      } as unknown as AccountEmailWorkflowsPersistence,
      mail: {
        sendPasswordReset: () => Promise.resolve({ delivered: true }),
      } as unknown as AuthMailDeliveryPort,
    })

    await expect(
      target.resetPassword(
        '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
        '95ee8d48-2f19-49be-af21-c5f471c1e502',
        now,
      ),
    ).resolves.toEqual({ mailDelivery: 'delivered' })
    const persistedInput = rotateAdministratorPasswordReset.mock.calls[0]?.[0]
    expect(persistedInput?.token.expiresAt).toEqual(
      new Date('2026-08-07T12:15:00.000Z'),
    )
  })

  it('commits the invitation before reporting a mail failure', async () => {
    const writes: StructuredLogRecord[] = []
    const sink = {
      write: (record: StructuredLogRecord): void => {
        writes.push(record)
      },
    }
    const audit = new AuthAuditLogger(sink)
    const createInvitation = jest.fn(() =>
      Promise.resolve({
        userId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
        email: 'new@example.com',
      }),
    )
    const target = service({
      persistence: {
        createInvitation,
      } as unknown as AccountEmailWorkflowsPersistence,
      mail: {
        sendEmailVerification: () => Promise.resolve({ delivered: false }),
        sendPasswordReset: () => Promise.resolve({ delivered: false }),
        sendAccountInvitation: () =>
          Promise.reject(new AuthMailDeliveryError()),
      },
      audit,
    })

    await expect(
      target.invite({
        actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
        email: ' New@example.com ',
        roleKeys: ['system.admin'],
        now,
      }),
    ).resolves.toEqual({ mailDelivery: 'failed' })
    expect(createInvitation).toHaveBeenCalledWith({
      actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
      actorAuthorization: {
        requiredRoleGroups: [['system.admin'], ['system.admin']],
      },
      email: 'New@example.com',
      normalizedEmail: 'new@example.com',
      roleKeys: ['system.admin'],
      tokenDigest: 'digest',
      expiresAt: new Date('2026-08-08T12:00:00.000Z'),
      createdAt: now,
    })
    expect(writes.map((entry) => entry.attributes)).toEqual([
      {
        kind: 'audit',
        action: 'account_invitation_create',
        outcome: 'partial',
        reasonCode: 'MAIL_DELIVERY_FAILED',
        actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
        targetType: 'user',
        targetId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
      },
    ])
    expect(audit.getFailureCount()).toBe(0)
  })

  it.each([
    {
      name: 'resend invitation',
      execute: (target: AccountEmailWorkflowsService) =>
        target.resendInvitation(
          '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
          '95ee8d48-2f19-49be-af21-c5f471c1e502',
          now,
        ),
      persistence: {
        resendInvitation: () => Promise.reject(new Error('database down')),
      },
    },
    {
      name: 'administrator password reset',
      execute: (target: AccountEmailWorkflowsService) =>
        target.resetPassword(
          '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
          '95ee8d48-2f19-49be-af21-c5f471c1e502',
          now,
        ),
      persistence: {
        rotateAdministratorPasswordReset: () =>
          Promise.reject(new Error('database down')),
      },
    },
  ])('maps unexpected persistence failure during $name to 503', async (row) => {
    const target = service({
      persistence:
        row.persistence as unknown as AccountEmailWorkflowsPersistence,
      mail: {} as AuthMailDeliveryPort,
    })

    await expect(row.execute(target)).rejects.toBeInstanceOf(
      AuthDependencyUnavailableError,
    )
  })

  it('rejects an invitation token that was not atomically accepted', async () => {
    const target = service({
      persistence: {
        isInvitationTokenEligible: () => Promise.resolve(true),
        acceptInvitation: () => Promise.resolve(false),
      } as unknown as AccountEmailWorkflowsPersistence,
      mail: {
        sendEmailVerification: () => Promise.resolve({ delivered: false }),
        sendPasswordReset: () => Promise.resolve({ delivered: false }),
        sendAccountInvitation: () => Promise.resolve({ delivered: false }),
      },
    })

    await expect(
      target.acceptInvitation({
        token: 'raw-token',
        password: 'a sufficiently long password',
        ipAddress: '127.0.0.1',
        now,
      }),
    ).rejects.toBeInstanceOf(AuthTokenInvalidOrExpiredError)
  })

  it('audits public invitation acceptance without token or request metadata', async () => {
    const events: AuthAuditEvent[] = []
    const target = service({
      persistence: {
        isInvitationTokenEligible: () => Promise.resolve(true),
        acceptInvitation: () => Promise.resolve(true),
      } as unknown as AccountEmailWorkflowsPersistence,
      audit: { emit: (event) => events.push(event) },
      mail: {} as AuthMailDeliveryPort,
    })

    await expect(
      target.acceptInvitation({
        token: 'raw-token',
        password: 'a sufficiently long password',
        ipAddress: '198.51.100.10',
        now,
      }),
    ).resolves.toBeUndefined()
    expect(events).toEqual([
      {
        action: 'account_invitation_accept',
        outcome: 'success',
        reasonCode: 'ACCOUNT_ACTIVATED',
      },
    ])
    expect(JSON.stringify(events)).not.toMatch(/token|password|ipAddress/iu)
  })

  it('returns a typed conflict instead of mail failure for a duplicate email', async () => {
    const target = service({
      persistence: {
        createInvitation: () => Promise.resolve(undefined),
      } as unknown as AccountEmailWorkflowsPersistence,
      mail: {
        sendEmailVerification: () => Promise.resolve({ delivered: false }),
        sendPasswordReset: () => Promise.resolve({ delivered: false }),
        sendAccountInvitation: () => Promise.resolve({ delivered: false }),
      },
    })

    await expect(
      target.invite({
        actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
        email: 'existing@example.com',
        roleKeys: ['system.admin'],
        now,
      }),
    ).rejects.toBeInstanceOf(AuthError)
  })

  it('returns a typed conflict for an unknown invitation role', async () => {
    const target = service({
      persistence: {} as AccountEmailWorkflowsPersistence,
      mail: {} as AuthMailDeliveryPort,
    })

    await expect(
      target.invite({
        actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
        email: 'new@example.com',
        roleKeys: ['unknown.role'],
        now,
      }),
    ).rejects.toBeInstanceOf(AuthError)
  })

  it('does not report a missing invitation target as a mail failure', async () => {
    const sendAccountInvitation = jest.fn()
    const target = service({
      persistence: {
        resendInvitation: () => Promise.resolve(undefined),
      } as unknown as AccountEmailWorkflowsPersistence,
      mail: {
        sendAccountInvitation,
      } as unknown as AuthMailDeliveryPort,
    })

    await expect(
      target.resendInvitation(
        '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
        '95ee8d48-2f19-49be-af21-c5f471c1e502',
        now,
      ),
    ).rejects.toBeInstanceOf(AuthError)
    expect(sendAccountInvitation).not.toHaveBeenCalled()
  })

  it('does not report an ineligible reset target as a mail failure', async () => {
    const sendPasswordReset = jest.fn()
    const target = service({
      persistence: {
        rotateAdministratorPasswordReset: () => Promise.resolve(undefined),
      } as unknown as AccountEmailWorkflowsPersistence,
      mail: {
        sendPasswordReset,
      } as unknown as AuthMailDeliveryPort,
    })

    await expect(
      target.resetPassword(
        '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
        '95ee8d48-2f19-49be-af21-c5f471c1e502',
        now,
      ),
    ).rejects.toBeInstanceOf(AuthError)
    expect(sendPasswordReset).not.toHaveBeenCalled()
  })

  it('does not hash a password before cheap invitation eligibility succeeds', async () => {
    const hash = jest.fn(() => Promise.resolve('password-hash'))
    const target = service({
      persistence: {
        isInvitationTokenEligible: () => Promise.resolve(false),
        acceptInvitation: () => Promise.resolve(false),
      } as unknown as AccountEmailWorkflowsPersistence,
      passwords: {
        hash,
        verify: () => Promise.resolve({ matches: false, needsRehash: false }),
      },
      mail: {} as AuthMailDeliveryPort,
    })

    await expect(
      target.acceptInvitation({
        token: 'raw-token',
        password: 'a sufficiently long password',
        ipAddress: '127.0.0.1',
        now,
      }),
    ).rejects.toBeInstanceOf(AuthTokenInvalidOrExpiredError)
    expect(hash).not.toHaveBeenCalled()
  })

  it('rate-limits invitation acceptance before eligibility and Argon2', async () => {
    const eligible = jest.fn(() => Promise.resolve(true))
    const hash = jest.fn(() => Promise.resolve('password-hash'))
    const target = service({
      persistence: {
        isInvitationTokenEligible: eligible,
      } as unknown as AccountEmailWorkflowsPersistence,
      passwords: {
        hash,
        verify: () => Promise.resolve({ matches: false, needsRehash: false }),
      },
      limiter: {
        consume: () => Promise.resolve({ allowed: false, retryAfterMs: 3_000 }),
      },
      mail: {} as AuthMailDeliveryPort,
    })

    await expect(
      target.acceptInvitation({
        token: 'raw-token',
        password: 'a sufficiently long password',
        ipAddress: '198.51.100.10',
        now,
      }),
    ).rejects.toBeInstanceOf(AuthRateLimitedError)
    expect(eligible).not.toHaveBeenCalled()
    expect(hash).not.toHaveBeenCalled()
  })
})
