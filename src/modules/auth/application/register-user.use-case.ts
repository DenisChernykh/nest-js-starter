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
  ONE_TIME_TOKEN_CODEC,
  type OneTimeTokenCodecPort,
} from './one-time-token-codec.port'
import {
  PUBLIC_AUTH_RATE_LIMITER,
  type PublicAuthRateLimiterPort,
} from './public-auth-rate-limiter.port'
import {
  REGISTRATION_PERSISTENCE,
  type RegistrationPersistencePort,
} from './registration-persistence.port'
import { SelfServiceAuthPolicy } from './self-service-auth.policy'
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from './password-hasher.port'

export interface RegisterUserInput {
  readonly email: string
  readonly password: string
  readonly ipAddress: string
  readonly now: Date
}

@Injectable()
export class RegisterUserUseCase {
  public constructor(
    @Inject(REGISTRATION_PERSISTENCE)
    private readonly persistence: RegistrationPersistencePort,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasherPort,
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

  public async execute(input: RegisterUserInput): Promise<void> {
    this.policy.assertOpen()
    const normalizedEmail = input.email.trim().toLowerCase()
    try {
      const decision = await this.limiter.consume({
        operation: 'register',
        ipAddress: input.ipAddress,
        normalizedEmail,
      })
      if (!decision.allowed)
        throw new AuthRateLimitedError(decision.retryAfterMs)
      const passwordHash = await this.passwords.hash(input.password)
      const issued = this.codec.issue()
      const result = await this.persistence.registerSelfServiceUser({
        email: input.email.trim(),
        normalizedEmail,
        passwordHash,
        tokenDigest: issued.digest,
        expiresAt: new Date(
          input.now.getTime() + this.policy.settings.verificationTtlMs,
        ),
        createdAt: input.now,
      })
      this.audit.emit({
        action: 'registration',
        outcome: result.created ? 'success' : 'conflict',
        reasonCode: result.created
          ? 'REGISTRATION_ACCEPTED'
          : 'EMAIL_ALREADY_EXISTS',
        ...(result.created
          ? {
              actorId: result.userId,
              targetType: 'user' as const,
              targetId: result.userId,
            }
          : {}),
      })
      if (!result.created) return
      await this.sendVerification(result.userId, result.email, issued.rawToken)
    } catch (error: unknown) {
      if (error instanceof AuthError) throw error
      throw new AuthDependencyUnavailableError()
    }
  }

  private async sendVerification(
    userId: string,
    email: string,
    rawToken: string,
  ): Promise<void> {
    try {
      const result = await this.mail.sendEmailVerification({
        to: email,
        verificationUrl: this.policy.verificationUrl(rawToken),
      })
      this.audit.emit({
        action: 'email_verification_send',
        outcome: result.delivered ? 'success' : 'partial',
        reasonCode: result.delivered
          ? 'MAIL_DELIVERED'
          : 'MAIL_DELIVERY_FAILED',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
      })
    } catch (error: unknown) {
      if (!(error instanceof AuthMailDeliveryError)) throw error
      this.audit.emit({
        action: 'email_verification_send',
        outcome: 'partial',
        reasonCode: 'MAIL_DELIVERY_FAILED',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
      })
    }
  }
}
