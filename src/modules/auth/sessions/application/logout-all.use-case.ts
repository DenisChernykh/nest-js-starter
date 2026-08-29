import { Inject, Injectable } from '@nestjs/common'

import {
  AuthDependencyUnavailableError,
  AuthError,
} from '../../public-contracts/auth-errors'
import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from '../../public-contracts/auth-audit.port'
import {
  SessionCleanupService,
  type AuthDurableMutationResult,
} from './session-cleanup.service'
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
    @Inject(SessionCleanupService)
    private readonly cleanup: SessionCleanupService,
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
      const cleanupComplete =
        await this.cleanup.cleanupAfterDurableInvalidation('logout-all', userId)
      this.audit.emit({
        action: 'logout_all',
        outcome: cleanupComplete ? 'success' : 'partial',
        reasonCode: cleanupComplete
          ? 'LOGOUT_ALL_COMPLETED'
          : 'CLEANUP_INCOMPLETE',
        actorId: userId,
        targetType: 'user',
        targetId: userId,
      })
      return { cleanupComplete }
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
