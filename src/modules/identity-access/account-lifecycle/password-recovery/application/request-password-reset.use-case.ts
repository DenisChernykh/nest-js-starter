import { Inject, Injectable } from '@nestjs/common'

import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from '../../../public-contracts/auth-audit.port'
import {
  AUTH_MAIL_DELIVERY,
  AuthMailDeliveryError,
  type AuthMailDeliveryPort,
} from '../../application/auth-mail-delivery.port'
import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthRateLimitedError,
} from '../../../public-contracts/auth-errors'
import {
  ONE_TIME_TOKEN_CODEC,
  type OneTimeTokenCodecPort,
} from '../../application/one-time-token-codec.port'
import {
  PUBLIC_AUTH_RATE_LIMITER,
  type PublicAuthRateLimiterPort,
} from '../../application/public-auth-rate-limiter.port'
import {
  PASSWORD_RECOVERY_PERSISTENCE,
  type PasswordRecoveryPersistencePort,
} from './password-recovery-persistence.port'
import { SelfServiceAuthPolicy } from '../../application/self-service-auth.policy'

export interface RequestPasswordResetInput {
  readonly email: string
  readonly ipAddress: string
  readonly now: Date
}

@Injectable()
export class RequestPasswordResetUseCase {
  public constructor(
    @Inject(PASSWORD_RECOVERY_PERSISTENCE)
    private readonly persistence: PasswordRecoveryPersistencePort,
    @Inject(PUBLIC_AUTH_RATE_LIMITER)
    private readonly limiter: PublicAuthRateLimiterPort,
    @Inject(ONE_TIME_TOKEN_CODEC)
    private readonly codec: OneTimeTokenCodecPort,
    @Inject(AUTH_MAIL_DELIVERY) private readonly mail: AuthMailDeliveryPort,
    @Inject(SelfServiceAuthPolicy)
    private readonly policy: SelfServiceAuthPolicy,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public async execute(input: RequestPasswordResetInput): Promise<void> {
    this.policy.assertOpen()
    const normalizedEmail = input.email.trim().toLowerCase()
    try {
      const decision = await this.limiter.consume({
        operation: 'password-reset-request',
        ipAddress: input.ipAddress,
        normalizedEmail,
      })
      if (!decision.allowed)
        throw new AuthRateLimitedError(decision.retryAfterMs)
      const issued = this.codec.issue()
      const target = await this.persistence.rotatePasswordResetToken(
        normalizedEmail,
        {
          tokenDigest: issued.digest,
          expiresAt: new Date(
            input.now.getTime() + this.policy.settings.passwordResetTtlMs,
          ),
          createdAt: input.now,
        },
        input.now,
      )
      if (target === undefined) return
      try {
        const result = await this.mail.sendPasswordReset({
          to: target.email,
          resetUrl: this.policy.resetUrl(issued.rawToken),
        })
        this.audit.emit({
          action: 'password_reset_request',
          outcome: result.delivered ? 'success' : 'partial',
          reasonCode: result.delivered
            ? 'MAIL_DELIVERED'
            : 'MAIL_DELIVERY_FAILED',
          actorId: target.userId,
          targetType: 'user',
          targetId: target.userId,
        })
      } catch (error: unknown) {
        if (!(error instanceof AuthMailDeliveryError)) throw error
        this.audit.emit({
          action: 'password_reset_request',
          outcome: 'partial',
          reasonCode: 'MAIL_DELIVERY_FAILED',
          actorId: target.userId,
          targetType: 'user',
          targetId: target.userId,
        })
      }
    } catch (error: unknown) {
      if (error instanceof AuthError) throw error
      throw new AuthDependencyUnavailableError()
    }
  }
}
