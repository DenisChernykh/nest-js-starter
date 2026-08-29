import { Inject, Injectable } from '@nestjs/common'

import { AuthDependencyUnavailableError, AuthError } from './auth-errors'
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
import { SESSION_STORE, type SessionStorePort } from './session-store.port'
import {
  SESSION_GENERATION,
  type SessionGenerationPort,
} from './session-generation.port'

/** Durably invalidates every generation before best-effort Redis cleanup. */
@Injectable()
export class LogoutAllUseCase {
  public constructor(
    @Inject(SESSION_GENERATION)
    private readonly generation: SessionGenerationPort,
    @Inject(SESSION_STORE)
    private readonly sessions: SessionStorePort,
    @Inject(AUTH_SESSION_CLEANUP_OBSERVER)
    private readonly cleanupObserver:
      AuthSessionCleanupObserver | undefined = undefined,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public async execute(userId: string): Promise<AuthDurableMutationResult> {
    return this.performLogoutAll(userId)
  }

  private async performLogoutAll(
    userId: string,
  ): Promise<AuthDurableMutationResult> {
    try {
      await this.generation.incrementSessionGeneration(userId)
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
      if (error instanceof AuthError) throw error
      throw new AuthDependencyUnavailableError()
    }
  }
}
