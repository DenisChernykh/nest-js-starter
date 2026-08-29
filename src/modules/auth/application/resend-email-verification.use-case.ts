import { Inject, Injectable } from '@nestjs/common'

import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from './auth-audit.port'
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
import {
  EMAIL_VERIFICATION_PERSISTENCE,
  type EmailVerificationPersistencePort,
} from './email-verification-persistence.port'
import {
  ONE_TIME_TOKEN_CODEC,
  type OneTimeTokenCodecPort,
} from './one-time-token-codec.port'
import {
  PUBLIC_AUTH_RATE_LIMITER,
  type PublicAuthRateLimiterPort,
} from './public-auth-rate-limiter.port'
import { SelfServiceAuthPolicy } from './self-service-auth.policy'

export interface ResendEmailVerificationInput {
  readonly email: string
  readonly ipAddress: string
  readonly now: Date
}

@Injectable()
export class ResendEmailVerificationUseCase {
  public constructor(
    @Inject(EMAIL_VERIFICATION_PERSISTENCE)
    private readonly persistence: EmailVerificationPersistencePort,
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

  public async execute(input: ResendEmailVerificationInput): Promise<void> {
    this.policy.assertOpen()
    const normalizedEmail = input.email.trim().toLowerCase()
    try {
      const decision = await this.limiter.consume({
        operation: 'email-verification-resend',
        ipAddress: input.ipAddress,
        normalizedEmail,
      })
      if (!decision.allowed)
        throw new AuthRateLimitedError(decision.retryAfterMs)
      const issued = this.codec.issue()
      const target = await this.persistence.rotateEmailVerificationToken(
        normalizedEmail,
        {
          tokenDigest: issued.digest,
          expiresAt: new Date(
            input.now.getTime() + this.policy.settings.verificationTtlMs,
          ),
          createdAt: input.now,
        },
        input.now,
      )
      if (target === undefined) return
      try {
        const result = await this.mail.sendEmailVerification({
          to: target.email,
          verificationUrl: this.policy.verificationUrl(issued.rawToken),
        })
        this.audit.emit({
          action: 'email_verification_send',
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
          action: 'email_verification_send',
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
