import { Inject, Injectable } from '@nestjs/common'

import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthenticationFailedError,
  AuthStateConflictError,
} from './auth-errors'
import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from './auth-audit.port'
import {
  AUTH_PERSISTENCE,
  type AuthPersistencePort,
} from './auth-persistence.port'
import {
  AUTH_SESSION_CLEANUP_OBSERVER,
  type AuthDurableMutationResult,
  type AuthSessionCleanupObserver,
} from './auth.types'
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from './password-hasher.port'
import { SESSION_STORE, type SessionStorePort } from './session-store.port'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

/** Current/new password mutation fields bound to one authenticated identity. */
export interface ChangePasswordInput {
  readonly userId: string
  readonly normalizedEmail: string
  readonly currentPassword: string
  readonly newPassword: string
}

/** Changes credentials durably before best-effort invalidation of Redis state. */
@Injectable()
export class ChangePasswordUseCase {
  public constructor(
    @Inject(AUTH_PERSISTENCE)
    private readonly persistence: AuthPersistencePort,
    @Inject(PASSWORD_HASHER)
    private readonly passwords: PasswordHasherPort,
    @Inject(TRANSACTION_PORT)
    private readonly transaction: TransactionPort,
    @Inject(SESSION_STORE)
    private readonly sessions: SessionStorePort,
    @Inject(AUTH_SESSION_CLEANUP_OBSERVER)
    private readonly cleanupObserver: AuthSessionCleanupObserver | undefined = undefined,
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
      const snapshot = await this.persistence.findCredentialByNormalizedEmail(
        input.normalizedEmail,
      )
      if (snapshot === undefined || snapshot.userId !== input.userId)
        throw new AuthenticationFailedError()
      const current = await this.passwords.verify(
        input.currentPassword,
        snapshot.passwordHash,
      )
      if (!current.matches) throw new AuthenticationFailedError()
      const nextHash = await this.passwords.hash(input.newPassword)
      await this.transaction.run(async () => {
        const replaced = await this.persistence.replacePasswordIfVersion(
          input.userId,
          snapshot.passwordVersion,
          nextHash,
        )
        if (!replaced) throw new AuthStateConflictError()
        await this.persistence.incrementSessionGeneration(input.userId)
      })
      try {
        await this.sessions.revokeAll(input.userId)
        this.audit.emit({
          action: 'password_change',
          outcome: 'success',
          reasonCode: 'PASSWORD_CHANGED',
          actorId: input.userId,
          targetType: 'user',
          targetId: input.userId,
        })
        return { cleanupComplete: true }
      } catch {
        this.cleanupObserver?.cleanupIncomplete('change-password', input.userId)
        this.audit.emit({
          action: 'password_change',
          outcome: 'partial',
          reasonCode: 'CLEANUP_INCOMPLETE',
          actorId: input.userId,
          targetType: 'user',
          targetId: input.userId,
        })
        return { cleanupComplete: false }
      }
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
