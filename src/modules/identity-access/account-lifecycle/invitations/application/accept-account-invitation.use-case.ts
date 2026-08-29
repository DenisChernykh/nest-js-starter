import { Inject, Injectable } from '@nestjs/common'

import {
  persistAccountLifecycleOperation,
  runAuditedAccountLifecycleWorkflow,
} from '../../application/account-lifecycle-workflow.support'
import { AccountEmailWorkflowsPolicy } from '../../application/account-email-workflows.policy'
import {
  ONE_TIME_TOKEN_CODEC,
  type OneTimeTokenCodecPort,
} from '../../application/one-time-token-codec.port'
import {
  PUBLIC_AUTH_RATE_LIMITER,
  type PublicAuthRateLimiterPort,
} from '../../application/public-auth-rate-limiter.port'
import { AuthTokenInvalidOrExpiredError } from '../../application/self-service-auth.policy'
import {
  INVITATION_PERSISTENCE,
  type InvitationPersistencePort,
} from './invitation-persistence.port'
import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from '../../../public-contracts/auth-audit.port'
import { AuthRateLimitedError } from '../../../public-contracts/auth-errors'
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from '../../../authentication/application/password-hasher.port'

export interface AcceptAccountInvitationInput {
  readonly token: string
  readonly password: string
  readonly ipAddress: string
  readonly now: Date
}

@Injectable()
export class AcceptAccountInvitationUseCase {
  public constructor(
    @Inject(INVITATION_PERSISTENCE)
    private readonly invitations: InvitationPersistencePort,
    @Inject(ONE_TIME_TOKEN_CODEC)
    private readonly codec: OneTimeTokenCodecPort,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasherPort,
    @Inject(PUBLIC_AUTH_RATE_LIMITER)
    private readonly limiter: PublicAuthRateLimiterPort,
    @Inject(AccountEmailWorkflowsPolicy)
    private readonly policy: AccountEmailWorkflowsPolicy,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public execute(input: AcceptAccountInvitationInput): Promise<void> {
    this.policy.assertEnabled()
    return runAuditedAccountLifecycleWorkflow({
      audit: this.audit,
      action: 'account_invitation_accept',
      operation: async () => {
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
        const eligible = await persistAccountLifecycleOperation(() =>
          this.invitations.isInvitationTokenEligible(tokenDigest, input.now),
        )
        if (!eligible) throw new AuthTokenInvalidOrExpiredError()
        const passwordHash = await this.passwords.hash(input.password)
        const accepted = await persistAccountLifecycleOperation(() =>
          this.invitations.acceptInvitation({
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
    })
  }
}
