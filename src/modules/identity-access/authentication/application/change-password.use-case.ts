import { Inject, Injectable } from '@nestjs/common'

import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthenticationFailedError,
  AuthStateConflictError,
} from '../../public-contracts/auth-errors'
import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from '../../public-contracts/auth-audit.port'
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from './password-hasher.port'
import {
  PASSWORD_CREDENTIALS,
  type PasswordCredentialPort,
} from './password-credential.port'
import {
  SessionCleanupService,
  type AuthDurableMutationResult,
} from '../../sessions/application/session-cleanup.service'

/** Current/new password mutation fields bound to one authenticated identity. */
export interface ChangePasswordInput {
  readonly userId: string
  readonly currentPassword: string
  readonly newPassword: string
}

/** Changes credentials durably before best-effort invalidation of Redis state. */
@Injectable()
export class ChangePasswordUseCase {
  public constructor(
    @Inject(PASSWORD_CREDENTIALS)
    private readonly credentials: PasswordCredentialPort,
    @Inject(PASSWORD_HASHER)
    private readonly passwords: PasswordHasherPort,
    @Inject(SessionCleanupService)
    private readonly cleanup: SessionCleanupService,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public async execute(
    input: ChangePasswordInput,
  ): Promise<AuthDurableMutationResult> {
    return this.performChange(input)
  }

  private async performChange(
    input: ChangePasswordInput,
  ): Promise<AuthDurableMutationResult> {
    try {
      const snapshot = await this.credentials.findCredentialByUserId(
        input.userId,
      )
      if (snapshot === undefined) throw new AuthenticationFailedError()
      const current = await this.passwords.verify(
        input.currentPassword,
        snapshot.passwordHash,
      )
      if (!current.matches) throw new AuthenticationFailedError()
      const nextHash = await this.passwords.hash(input.newPassword)
      const replaced = await this.credentials.changePasswordAndInvalidate({
        userId: input.userId,
        expectedVersion: snapshot.passwordVersion,
        passwordHash: nextHash,
      })
      if (!replaced) throw new AuthStateConflictError()
      const cleanupComplete =
        await this.cleanup.cleanupAfterDurableInvalidation(
          'change-password',
          input.userId,
        )
      this.audit.emit({
        action: 'password_change',
        outcome: cleanupComplete ? 'success' : 'partial',
        reasonCode: cleanupComplete ? 'PASSWORD_CHANGED' : 'CLEANUP_INCOMPLETE',
        actorId: input.userId,
        targetType: 'user',
        targetId: input.userId,
      })
      return { cleanupComplete }
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        this.audit.emit({
          action: 'password_change',
          outcome: error.code === 'AUTH_STATE_CONFLICT' ? 'conflict' : 'denied',
          reasonCode:
            error.code === 'AUTH_STATE_CONFLICT'
              ? 'STATE_CONFLICT'
              : error.code === 'AUTHENTICATION_FAILED'
                ? 'INVALID_CURRENT_PASSWORD'
                : 'DEPENDENCY_UNAVAILABLE',
          actorId: input.userId,
          targetType: 'user',
          targetId: input.userId,
        })
        throw error
      }
      this.audit.emit({
        action: 'password_change',
        outcome: 'denied',
        reasonCode: 'DEPENDENCY_UNAVAILABLE',
        actorId: input.userId,
        targetType: 'user',
        targetId: input.userId,
      })
      throw new AuthDependencyUnavailableError()
    }
  }
}
