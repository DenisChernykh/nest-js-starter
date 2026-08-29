import { Inject, Injectable } from '@nestjs/common'

import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from '../../../public-contracts/auth-audit.port'
import {
  SessionCleanupService,
  type AuthDurableMutationResult,
} from '../../../sessions/application/session-cleanup.service'
import {
  AuthDependencyUnavailableError,
  AuthError,
} from '../../../public-contracts/auth-errors'
import {
  PASSWORD_RECOVERY_PERSISTENCE,
  type PasswordRecoveryPersistencePort,
} from './password-recovery-persistence.port'
import {
  ONE_TIME_TOKEN_CODEC,
  type OneTimeTokenCodecPort,
} from '../../application/one-time-token-codec.port'
import {
  AuthTokenInvalidOrExpiredError,
  SelfServiceAuthPolicy,
} from '../../application/self-service-auth.policy'
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from '../../../authentication/application/password-hasher.port'

export interface ConfirmPasswordResetInput {
  readonly token: string
  readonly newPassword: string
  readonly now: Date
}

@Injectable()
export class ConfirmPasswordResetUseCase {
  public constructor(
    @Inject(PASSWORD_RECOVERY_PERSISTENCE)
    private readonly persistence: PasswordRecoveryPersistencePort,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasherPort,
    @Inject(ONE_TIME_TOKEN_CODEC)
    private readonly codec: OneTimeTokenCodecPort,
    @Inject(SelfServiceAuthPolicy)
    private readonly policy: SelfServiceAuthPolicy,
    @Inject(SessionCleanupService)
    private readonly cleanup: SessionCleanupService,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public async execute(
    input: ConfirmPasswordResetInput,
  ): Promise<AuthDurableMutationResult> {
    this.policy.assertPasswordResetConfirmationEnabled()
    try {
      const tokenDigest = this.codec.digest(input.token)
      if (tokenDigest === undefined) throw new AuthTokenInvalidOrExpiredError()
      const source = await this.persistence.getEligiblePasswordResetTokenSource(
        tokenDigest,
        input.now,
      )
      if (
        source === undefined ||
        !this.policy.allowsPasswordResetSource(source)
      )
        throw new AuthTokenInvalidOrExpiredError()
      const passwordHash = await this.passwords.hash(input.newPassword)
      const target = await this.persistence.confirmPasswordReset({
        tokenDigest,
        source,
        now: input.now,
        passwordHash,
      })
      if (target === undefined) throw new AuthTokenInvalidOrExpiredError()
      const cleanupComplete =
        await this.cleanup.cleanupAfterDurableInvalidation(
          'password-reset',
          target.userId,
        )
      this.audit.emit({
        action: 'password_reset_confirm',
        outcome: cleanupComplete ? 'success' : 'partial',
        reasonCode: cleanupComplete
          ? 'PASSWORD_RESET_COMPLETED'
          : 'CLEANUP_INCOMPLETE',
        actorId: target.userId,
        targetType: 'user',
        targetId: target.userId,
      })
      return { cleanupComplete }
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        if (error instanceof AuthTokenInvalidOrExpiredError) {
          this.audit.emit({
            action: 'password_reset_confirm',
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
