import { AuthDependencyUnavailableError, AuthError } from './auth-errors'
import type { AuthPersistencePort } from './auth-persistence.port'
import type {
  AuthDurableMutationResult,
  AuthSessionCleanupObserver,
} from './auth.types'
import type { SessionStorePort } from './session-store.port'
import type { TransactionPort } from '@/shared/application/transaction.port'
import { NOOP_AUTH_AUDIT, type AuthAuditPort } from './auth-audit.port'
import {
  NOOP_TELEMETRY,
  type TelemetryPort,
} from '@/shared/application/telemetry.port'

/** Durably invalidates every generation before best-effort Redis cleanup. */
export class LogoutAllUseCase {
  public constructor(
    private readonly persistence: AuthPersistencePort,
    private readonly transaction: TransactionPort,
    private readonly sessions: SessionStorePort,
    private readonly cleanupObserver?: AuthSessionCleanupObserver,
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
    private readonly telemetry: TelemetryPort = NOOP_TELEMETRY,
  ) {}

  public async execute(userId: string): Promise<AuthDurableMutationResult> {
    return this.telemetry.runAuthOperation('logout_all', () =>
      this.performLogoutAll(userId),
    )
  }

  private async performLogoutAll(
    userId: string,
  ): Promise<AuthDurableMutationResult> {
    try {
      await this.transaction.run(() =>
        this.persistence.incrementSessionGeneration(userId),
      )
      try {
        await this.sessions.revokeAll(userId)
        this.audit.emit({
          action: 'logout_all',
          outcome: 'success',
          reasonCode: 'LOGOUT_ALL_COMPLETED',
          actorId: userId,
          targetType: 'user',
          targetId: userId,
        })
        this.telemetry.recordAuthOutcome('logout_all', 'success')
        return { cleanupComplete: true }
      } catch {
        this.cleanupObserver?.cleanupIncomplete('logout-all', userId)
        this.audit.emit({
          action: 'logout_all',
          outcome: 'partial',
          reasonCode: 'CLEANUP_INCOMPLETE',
          actorId: userId,
          targetType: 'user',
          targetId: userId,
        })
        this.telemetry.recordAuthOutcome('logout_all', 'partial')
        return { cleanupComplete: false }
      }
    } catch (error: unknown) {
      this.audit.emit({
        action: 'logout_all',
        outcome: 'denied',
        reasonCode: 'DEPENDENCY_UNAVAILABLE',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
      })
      this.telemetry.recordAuthOutcome('logout_all', 'dependency_error')
      if (error instanceof AuthError) throw error
      throw new AuthDependencyUnavailableError()
    }
  }
}
