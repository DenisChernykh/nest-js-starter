import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthenticationFailedError,
  AuthStateConflictError,
} from './auth-errors'
import type { AuthPersistencePort } from './auth-persistence.port'
import type {
  AuthDurableMutationResult,
  AuthSessionCleanupObserver,
} from './auth.types'
import type { PasswordHasherPort } from './password-hasher.port'
import type { SessionStorePort } from './session-store.port'
import type { TransactionPort } from '@/shared/application/transaction.port'
import { NOOP_AUTH_AUDIT, type AuthAuditPort } from './auth-audit.port'
import {
  NOOP_AUTH_TELEMETRY,
  type AuthTelemetryOutcome,
  type AuthTelemetryPort,
} from './auth-telemetry.port'

/** Current/new password mutation fields bound to one authenticated identity. */
export interface ChangePasswordInput {
  readonly userId: string
  readonly normalizedEmail: string
  readonly currentPassword: string
  readonly newPassword: string
}

/** Changes credentials durably before best-effort invalidation of Redis state. */
export class ChangePasswordUseCase {
  public constructor(
    private readonly persistence: AuthPersistencePort,
    private readonly passwords: PasswordHasherPort,
    private readonly transaction: TransactionPort,
    private readonly sessions: SessionStorePort,
    private readonly cleanupObserver?: AuthSessionCleanupObserver,
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
    private readonly telemetry: AuthTelemetryPort = NOOP_AUTH_TELEMETRY,
  ) {}

  public async execute(
    input: ChangePasswordInput,
  ): Promise<AuthDurableMutationResult> {
    return this.telemetry.runAuthOperation('change_password', () =>
      this.performChange(input),
    )
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
        this.telemetry.recordAuthOutcome('change_password', 'success')
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
        this.telemetry.recordAuthOutcome('change_password', 'partial')
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
        this.telemetry.recordAuthOutcome(
          'change_password',
          this.authErrorOutcome(error),
        )
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
      this.telemetry.recordAuthOutcome('change_password', 'dependency_error')
      throw new AuthDependencyUnavailableError()
    }
  }

  private authErrorOutcome(error: AuthError): AuthTelemetryOutcome {
    if (error.code === 'AUTH_STATE_CONFLICT') return 'conflict'
    if (error.code === 'AUTHENTICATION_FAILED') return 'denied'
    return 'dependency_error'
  }
}
