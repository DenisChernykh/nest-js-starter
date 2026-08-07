import { Inject, Injectable } from '@nestjs/common'

import {
  ACCOUNT_EMAIL_WORKFLOWS,
  type AccountEmailWorkflowsPort,
} from './account-email-workflows.port'
import { AccountEmailWorkflowsPolicy } from './account-email-workflows.policy'
import {
  AUTH_MAIL_DELIVERY,
  AuthMailDeliveryError,
  type AuthMailDeliveryPort,
} from './auth-mail-delivery.port'
import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthRateLimitedError,
} from './auth-errors'
import { AccountRoleUnknownError } from './account-administration.service'
import type { AccountActorAuthorization } from './account-administration.port'
import {
  ONE_TIME_TOKEN_CODEC,
  type OneTimeTokenCodecPort,
} from './one-time-token-codec.port'
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from './password-hasher.port'
import {
  AUTH_ACCOUNTS_MANAGE_PERMISSION,
  AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
  RoleRegistry,
} from './role-registry'
import type { PermissionKey } from '@/shared/application/permission'
import {
  PUBLIC_AUTH_RATE_LIMITER,
  type PublicAuthRateLimiterPort,
} from './public-auth-rate-limiter.port'
import { AuthTokenInvalidOrExpiredError } from './self-service-auth.policy'
import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditAction,
  type AuthAuditPort,
} from './auth-audit.port'

export interface AccountMailDeliveryResult {
  readonly mailDelivery: 'delivered' | 'failed'
}

export class AccountEmailAlreadyExistsError extends AuthError {
  public constructor() {
    super('AUTH_STATE_CONFLICT', 'An account already uses this email')
    this.name = 'AccountEmailAlreadyExistsError'
  }
}

export class AccountEmailWorkflowTargetUnavailableError extends AuthError {
  public constructor() {
    super(
      'AUTH_STATE_CONFLICT',
      'The account is not eligible for this workflow',
    )
    this.name = 'AccountEmailWorkflowTargetUnavailableError'
  }
}

@Injectable()
export class AccountEmailWorkflowsService {
  public constructor(
    @Inject(ACCOUNT_EMAIL_WORKFLOWS)
    private readonly persistence: AccountEmailWorkflowsPort,
    @Inject(ONE_TIME_TOKEN_CODEC)
    private readonly codec: OneTimeTokenCodecPort,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasherPort,
    @Inject(AUTH_MAIL_DELIVERY) private readonly mail: AuthMailDeliveryPort,
    @Inject(AccountEmailWorkflowsPolicy)
    private readonly policy: AccountEmailWorkflowsPolicy,
    @Inject(RoleRegistry) private readonly roles: RoleRegistry,
    @Inject(PUBLIC_AUTH_RATE_LIMITER)
    private readonly limiter: PublicAuthRateLimiterPort,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public async invite(input: {
    readonly actorId: string
    readonly email: string
    readonly roleKeys: readonly string[]
    readonly now: Date
  }): Promise<AccountMailDeliveryResult> {
    this.policy.assertEnabled()
    return this.auditedWorkflow(
      'account_invitation_create',
      input.actorId,
      undefined,
      async () => {
        if (input.roleKeys.some((key) => !this.roles.hasRole(key)))
          throw new AccountRoleUnknownError()
        const issued = this.codec.issue()
        const target = await this.persist(() =>
          this.persistence.createInvitation({
            actorId: input.actorId,
            actorAuthorization: this.actorAuthorization(
              AUTH_ACCOUNTS_MANAGE_PERMISSION,
              AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
            ),
            email: input.email.trim(),
            normalizedEmail: input.email.trim().toLowerCase(),
            roleKeys: input.roleKeys,
            tokenDigest: issued.digest,
            expiresAt: new Date(
              input.now.getTime() + this.policy.settings.invitationTtlMs,
            ),
            createdAt: input.now,
          }),
        )
        if (target === undefined) throw new AccountEmailAlreadyExistsError()
        const result = await this.sendInvitation(target.email, issued.rawToken)
        this.auditMailResult(
          'account_invitation_create',
          input.actorId,
          target.userId,
          result,
        )
        return result
      },
    )
  }

  public async resendInvitation(
    actorId: string,
    accountId: string,
    now: Date,
  ): Promise<AccountMailDeliveryResult> {
    this.policy.assertEnabled()
    return this.auditedWorkflow(
      'account_invitation_resend',
      actorId,
      accountId,
      async () => {
        const issued = this.codec.issue()
        const target = await this.persist(() =>
          this.persistence.resendInvitation({
            actorId,
            accountId,
            actorAuthorization: this.actorAuthorization(
              AUTH_ACCOUNTS_MANAGE_PERMISSION,
            ),
            token: {
              tokenDigest: issued.digest,
              expiresAt: new Date(
                now.getTime() + this.policy.settings.invitationTtlMs,
              ),
              createdAt: now,
            },
            now,
          }),
        )
        if (target === undefined)
          throw new AccountEmailWorkflowTargetUnavailableError()
        const result = await this.sendInvitation(target.email, issued.rawToken)
        this.auditMailResult(
          'account_invitation_resend',
          actorId,
          target.userId,
          result,
        )
        return result
      },
    )
  }

  public async resetPassword(
    actorId: string,
    accountId: string,
    now: Date,
  ): Promise<AccountMailDeliveryResult> {
    this.policy.assertEnabled()
    return this.auditedWorkflow(
      'admin_password_reset_request',
      actorId,
      accountId,
      async () => {
        const issued = this.codec.issue()
        const target = await this.persist(() =>
          this.persistence.rotateAdministratorPasswordReset({
            actorId,
            accountId,
            actorAuthorization: this.actorAuthorization(
              AUTH_ACCOUNTS_MANAGE_PERMISSION,
            ),
            token: {
              tokenDigest: issued.digest,
              expiresAt: new Date(now.getTime() + 1_800_000),
              createdAt: now,
            },
            now,
          }),
        )
        if (target === undefined)
          throw new AccountEmailWorkflowTargetUnavailableError()
        let delivery: AccountMailDeliveryResult
        try {
          const result = await this.mail.sendPasswordReset({
            to: target.email,
            resetUrl: `${this.policy.settings.publicAppUrl}/auth/reset-password#token=${issued.rawToken}`,
          })
          delivery = {
            mailDelivery: result.delivered ? 'delivered' : 'failed',
          }
        } catch (error: unknown) {
          if (!(error instanceof AuthMailDeliveryError)) throw error
          delivery = { mailDelivery: 'failed' }
        }
        this.auditMailResult(
          'admin_password_reset_request',
          actorId,
          target.userId,
          delivery,
        )
        return delivery
      },
    )
  }

  public async acceptInvitation(input: {
    readonly token: string
    readonly password: string
    readonly ipAddress: string
    readonly now: Date
  }): Promise<void> {
    this.policy.assertEnabled()
    return this.auditedWorkflow(
      'account_invitation_accept',
      undefined,
      undefined,
      async () => {
        const tokenDigest = this.codec.digest(input.token)
        if (tokenDigest === undefined)
          throw new AuthTokenInvalidOrExpiredError()
        const decision = await this.limiter.consume({
          operation: 'invitation-accept',
          ipAddress: input.ipAddress,
          normalizedEmail: tokenDigest,
        })
        if (!decision.allowed)
          throw new AuthRateLimitedError(decision.retryAfterMs)
        const eligible = await this.persist(() =>
          this.persistence.isInvitationTokenEligible(tokenDigest, input.now),
        )
        if (!eligible) throw new AuthTokenInvalidOrExpiredError()
        const passwordHash = await this.passwords.hash(input.password)
        const accepted = await this.persist(() =>
          this.persistence.acceptInvitation({
            tokenDigest,
            passwordHash,
            now: input.now,
          }),
        )
        if (!accepted) throw new AuthTokenInvalidOrExpiredError()
        this.audit.emit({
          action: 'account_invitation_accept',
          outcome: 'success',
          reasonCode: 'ACCOUNT_ACTIVATED',
        })
      },
    )
  }

  private async sendInvitation(
    email: string,
    rawToken: string,
  ): Promise<AccountMailDeliveryResult> {
    try {
      const result = await this.mail.sendAccountInvitation({
        to: email,
        invitationUrl: this.policy.invitationUrl(rawToken),
      })
      return { mailDelivery: result.delivered ? 'delivered' : 'failed' }
    } catch (error: unknown) {
      if (error instanceof AuthMailDeliveryError)
        return { mailDelivery: 'failed' }
      throw error
    }
  }

  private actorAuthorization(
    ...permissions: readonly PermissionKey[]
  ): AccountActorAuthorization {
    return {
      requiredRoleGroups: permissions.map((permission) =>
        this.roles.roleKeysGranting(permission),
      ),
    }
  }

  private async persist<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error: unknown) {
      if (error instanceof AuthError) throw error
      throw new AuthDependencyUnavailableError()
    }
  }

  private auditMailResult(
    action: Extract<
      AuthAuditAction,
      | 'account_invitation_create'
      | 'account_invitation_resend'
      | 'admin_password_reset_request'
    >,
    actorId: string,
    targetId: string,
    result: AccountMailDeliveryResult,
  ): void {
    this.audit.emit({
      action,
      outcome: result.mailDelivery === 'delivered' ? 'success' : 'partial',
      reasonCode:
        result.mailDelivery === 'delivered'
          ? 'MAIL_DELIVERED'
          : 'MAIL_DELIVERY_FAILED',
      actorId,
      targetType: 'user',
      targetId,
    })
  }

  private async auditedWorkflow<T>(
    action: Extract<
      AuthAuditAction,
      | 'account_invitation_create'
      | 'account_invitation_resend'
      | 'admin_password_reset_request'
      | 'account_invitation_accept'
    >,
    actorId: string | undefined,
    targetId: string | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation()
    } catch (error: unknown) {
      const normalized =
        error instanceof AuthError
          ? error
          : new AuthDependencyUnavailableError()
      const result =
        normalized instanceof AccountRoleUnknownError
          ? { outcome: 'denied' as const, reasonCode: 'UNKNOWN_ROLE' }
          : normalized instanceof AccountEmailAlreadyExistsError
            ? {
                outcome: 'conflict' as const,
                reasonCode: 'EMAIL_ALREADY_EXISTS',
              }
            : normalized instanceof AccountEmailWorkflowTargetUnavailableError
              ? { outcome: 'conflict' as const, reasonCode: 'STATE_CONFLICT' }
              : normalized instanceof AuthTokenInvalidOrExpiredError
                ? {
                    outcome: 'denied' as const,
                    reasonCode: 'TOKEN_INVALID_OR_EXPIRED',
                  }
                : normalized instanceof AuthRateLimitedError
                  ? { outcome: 'denied' as const, reasonCode: 'RATE_LIMITED' }
                  : normalized.code === 'AUTHORIZATION_DENIED'
                    ? {
                        outcome: 'denied' as const,
                        reasonCode: 'AUTHORIZATION_DENIED',
                      }
                    : normalized.code === 'AUTH_DEPENDENCY_UNAVAILABLE'
                      ? {
                          outcome: 'denied' as const,
                          reasonCode: 'DEPENDENCY_UNAVAILABLE',
                        }
                      : undefined
      if (result !== undefined)
        this.audit.emit({
          action,
          ...result,
          ...(actorId === undefined ? {} : { actorId }),
          ...(targetId === undefined
            ? {}
            : { targetType: 'user' as const, targetId }),
        })
      throw normalized
    }
  }
}
