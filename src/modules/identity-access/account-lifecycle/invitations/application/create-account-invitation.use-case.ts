import { Inject, Injectable } from '@nestjs/common'

import {
  AccountEmailAlreadyExistsError,
  AccountLifecycleRoleUnknownError,
} from '../../application/account-lifecycle-errors'
import {
  accountActorAuthorization,
  auditAccountLifecycleMailResult,
  persistAccountLifecycleOperation,
  runAuditedAccountLifecycleWorkflow,
} from '../../application/account-lifecycle-workflow.support'
import type { AccountMailDeliveryResult } from '../../application/account-mail-delivery.result'
import { AccountEmailWorkflowsPolicy } from '../../application/account-email-workflows.policy'
import {
  AUTH_MAIL_DELIVERY,
  AuthMailDeliveryError,
  type AuthMailDeliveryPort,
} from '../../application/auth-mail-delivery.port'
import {
  ONE_TIME_TOKEN_CODEC,
  type OneTimeTokenCodecPort,
} from '../../application/one-time-token-codec.port'
import {
  INVITATION_PERSISTENCE,
  type InvitationPersistencePort,
} from './invitation-persistence.port'
import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from '../../../public-contracts/auth-audit.port'
import {
  AUTH_ACCOUNTS_MANAGE_PERMISSION,
  AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
  RoleRegistry,
} from '../../../authorization/application/role-registry'

export interface CreateAccountInvitationInput {
  readonly actorId: string
  readonly email: string
  readonly roleKeys: readonly string[]
  readonly now: Date
}

@Injectable()
export class CreateAccountInvitationUseCase {
  public constructor(
    @Inject(INVITATION_PERSISTENCE)
    private readonly invitations: InvitationPersistencePort,
    @Inject(ONE_TIME_TOKEN_CODEC)
    private readonly codec: OneTimeTokenCodecPort,
    @Inject(AUTH_MAIL_DELIVERY) private readonly mail: AuthMailDeliveryPort,
    @Inject(AccountEmailWorkflowsPolicy)
    private readonly policy: AccountEmailWorkflowsPolicy,
    @Inject(RoleRegistry) private readonly roles: RoleRegistry,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public execute(
    input: CreateAccountInvitationInput,
  ): Promise<AccountMailDeliveryResult> {
    this.policy.assertEnabled()
    return runAuditedAccountLifecycleWorkflow({
      audit: this.audit,
      action: 'account_invitation_create',
      actorId: input.actorId,
      operation: async () => {
        if (input.roleKeys.some((key) => !this.roles.hasRole(key)))
          throw new AccountLifecycleRoleUnknownError()
        const issued = this.codec.issue()
        const target = await persistAccountLifecycleOperation(() =>
          this.invitations.createInvitation({
            actorId: input.actorId,
            actorAuthorization: accountActorAuthorization(
              this.roles,
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
        auditAccountLifecycleMailResult(
          this.audit,
          'account_invitation_create',
          input.actorId,
          target.userId,
          result,
        )
        return result
      },
    })
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
}
