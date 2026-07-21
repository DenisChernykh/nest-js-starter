import type { AuthenticatedPrincipal } from './auth.types'
import type { SessionStorePort } from './session-store.port'
import { NOOP_AUTH_AUDIT, type AuthAuditPort } from './auth-audit.port'

/** Revokes one public session identifier within authenticated user ownership. */
export class RevokeSessionUseCase {
  public constructor(
    private readonly sessions: SessionStorePort,
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public async execute(
    principal: AuthenticatedPrincipal,
    publicId: string,
  ): Promise<boolean> {
    try {
      const existed = await this.sessions.revoke(principal.userId, publicId)
      this.audit.emit({
        action: 'session_revoke',
        outcome: existed ? 'success' : 'denied',
        reasonCode: existed ? 'SESSION_REVOKED' : 'SESSION_NOT_FOUND',
        actorId: principal.userId,
        sessionId: principal.sessionId,
        targetType: 'session',
        targetId: publicId,
      })
      return existed
    } catch (error: unknown) {
      this.audit.emit({
        action: 'session_revoke',
        outcome: 'denied',
        reasonCode: 'DEPENDENCY_UNAVAILABLE',
        actorId: principal.userId,
        sessionId: principal.sessionId,
        targetType: 'session',
        targetId: publicId,
      })
      throw error
    }
  }
}
