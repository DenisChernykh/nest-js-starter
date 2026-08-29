import { Inject, Injectable } from '@nestjs/common'

import { AccountEmailWorkflowTargetUnavailableError } from '../../application/account-lifecycle-errors'
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
  PASSWORD_RECOVERY_PERSISTENCE,
  type PasswordRecoveryPersistencePort,
} from './password-recovery-persistence.port'
import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from '../../../public-contracts/auth-audit.port'
import {
  AUTH_ACCOUNTS_MANAGE_PERMISSION,
  RoleRegistry,
} from '../../../authorization/application/role-registry'

export interface RequestAdministratorPasswordResetInput {
  readonly actorId: string
  readonly accountId: string
  readonly now: Date
}

@Injectable()
export class RequestAdministratorPasswordResetUseCase {
  public constructor(
    @Inject(PASSWORD_RECOVERY_PERSISTENCE)
    private readonly passwordRecovery: PasswordRecoveryPersistencePort,
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
    input: RequestAdministratorPasswordResetInput,
  ): Promise<AccountMailDeliveryResult> {
    this.policy.assertEnabled()
    return runAuditedAccountLifecycleWorkflow({
      audit: this.audit,
      action: 'admin_password_reset_request',
      actorId: input.actorId,
      targetId: input.accountId,
      operation: async () => {
        const issued = this.codec.issue()
        const target = await persistAccountLifecycleOperation(() =>
          this.passwordRecovery.rotateAdministratorPasswordReset({
            actorId: input.actorId,
            accountId: input.accountId,
            actorAuthorization: accountActorAuthorization(
              this.roles,
              AUTH_ACCOUNTS_MANAGE_PERMISSION,
            ),
            token: {
              tokenDigest: issued.digest,
              expiresAt: new Date(
                input.now.getTime() + this.policy.settings.passwordResetTtlMs,
              ),
              createdAt: input.now,
            },
            now: input.now,
          }),
        )
        if (target === undefined)
          throw new AccountEmailWorkflowTargetUnavailableError()
        const result = await this.sendPasswordReset(
          target.email,
          issued.rawToken,
        )
        auditAccountLifecycleMailResult(
          this.audit,
          'admin_password_reset_request',
          input.actorId,
          target.userId,
          result,
        )
        return result
      },
    })
  }

  private async sendPasswordReset(
    email: string,
    rawToken: string,
  ): Promise<AccountMailDeliveryResult> {
    try {
      const result = await this.mail.sendPasswordReset({
        to: email,
        resetUrl: `${this.policy.settings.publicAppUrl}/auth/reset-password#token=${rawToken}`,
      })
      return { mailDelivery: result.delivered ? 'delivered' : 'failed' }
    } catch (error: unknown) {
      if (error instanceof AuthMailDeliveryError)
        return { mailDelivery: 'failed' }
      throw error
    }
  }
}
