import { Inject, Injectable } from '@nestjs/common'

import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from './auth-audit.port'
import { AuthDependencyUnavailableError, AuthError } from './auth-errors'
import {
  AUTH_PERSISTENCE,
  type AuthPersistencePort,
} from './auth-persistence.port'
import {
  ONE_TIME_TOKEN_CODEC,
  type OneTimeTokenCodecPort,
} from './one-time-token-codec.port'
import {
  AuthTokenInvalidOrExpiredError,
  SelfServiceAuthPolicy,
} from './self-service-auth.policy'

export interface ConfirmEmailVerificationInput {
  readonly token: string
  readonly now: Date
}

@Injectable()
export class ConfirmEmailVerificationUseCase {
  public constructor(
    @Inject(AUTH_PERSISTENCE) private readonly persistence: AuthPersistencePort,
    @Inject(ONE_TIME_TOKEN_CODEC)
    private readonly codec: OneTimeTokenCodecPort,
    @Inject(SelfServiceAuthPolicy)
    private readonly policy: SelfServiceAuthPolicy,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public async execute(input: ConfirmEmailVerificationInput): Promise<void> {
    this.policy.assertOpen()
    try {
      const tokenDigest = this.codec.digest(input.token)
      if (tokenDigest === undefined) throw new AuthTokenInvalidOrExpiredError()
      const target = await this.persistence.confirmEmailVerification(
        tokenDigest,
        input.now,
      )
      if (target === undefined) throw new AuthTokenInvalidOrExpiredError()
      this.audit.emit({
        action: 'email_verification_confirm',
        outcome: 'success',
        reasonCode: 'EMAIL_VERIFIED',
        actorId: target.userId,
        targetType: 'user',
        targetId: target.userId,
      })
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        if (error instanceof AuthTokenInvalidOrExpiredError) {
          this.audit.emit({
            action: 'email_verification_confirm',
            outcome: 'denied',
            reasonCode: 'TOKEN_INVALID_OR_EXPIRED',
          })
        }
        throw error
      }
      throw new AuthDependencyUnavailableError()
    }
  }
}
