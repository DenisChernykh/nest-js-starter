import { Inject, Injectable } from '@nestjs/common'

import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from './auth-audit.port'
import {
  AUTH_SESSION_CLEANUP_OBSERVER,
  type AuthDurableMutationResult,
  type AuthSessionCleanupObserver,
} from './auth.types'
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
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from './password-hasher.port'
import { SESSION_STORE, type SessionStorePort } from './session-store.port'

export interface ConfirmPasswordResetInput {
  readonly token: string
  readonly newPassword: string
  readonly now: Date
}

@Injectable()
export class ConfirmPasswordResetUseCase {
  public constructor(
    @Inject(AUTH_PERSISTENCE) private readonly persistence: AuthPersistencePort,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasherPort,
    @Inject(ONE_TIME_TOKEN_CODEC)
    private readonly codec: OneTimeTokenCodecPort,
    @Inject(SelfServiceAuthPolicy)
    private readonly policy: SelfServiceAuthPolicy,
    @Inject(SESSION_STORE) private readonly sessions: SessionStorePort,
    @Inject(AUTH_SESSION_CLEANUP_OBSERVER)
    private readonly cleanupObserver:
      AuthSessionCleanupObserver | undefined = undefined,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public async execute(
    input: ConfirmPasswordResetInput,
  ): Promise<AuthDurableMutationResult> {
    this.policy.assertOpen()
    try {
      const tokenDigest = this.codec.digest(input.token)
      if (tokenDigest === undefined) throw new AuthTokenInvalidOrExpiredError()
      const eligible = await this.persistence.isPasswordResetTokenEligible(
        tokenDigest,
        input.now,
      )
      if (!eligible) throw new AuthTokenInvalidOrExpiredError()
      const passwordHash = await this.passwords.hash(input.newPassword)
      const target = await this.persistence.confirmPasswordReset({
        tokenDigest,
        now: input.now,
        passwordHash,
      })
      if (target === undefined) throw new AuthTokenInvalidOrExpiredError()
      try {
        await this.sessions.revokeAll(target.userId)
        this.audit.emit({
          action: 'password_reset_confirm',
          outcome: 'success',
          reasonCode: 'PASSWORD_RESET_COMPLETED',
          actorId: target.userId,
          targetType: 'user',
          targetId: target.userId,
        })
        return { cleanupComplete: true }
      } catch {
        this.cleanupObserver?.cleanupIncomplete('password-reset', target.userId)
        this.audit.emit({
          action: 'password_reset_confirm',
          outcome: 'partial',
          reasonCode: 'CLEANUP_INCOMPLETE',
          actorId: target.userId,
          targetType: 'user',
          targetId: target.userId,
        })
        return { cleanupComplete: false }
      }
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
