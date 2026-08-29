import { Inject, Injectable } from '@nestjs/common'

import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from './auth-audit.port'
import type { AuthenticatedPrincipal } from '../public-contracts/authenticated-principal'
import { SESSION_STORE, type SessionStorePort } from './session-store.port'

/** Revokes one public session identifier within authenticated user ownership. */
@Injectable()
export class RevokeSessionUseCase {
  public constructor(
    @Inject(SESSION_STORE)
    private readonly sessions: SessionStorePort,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public async execute(
    principal: AuthenticatedPrincipal,
    publicId: string,
  ): Promise<boolean> {
    return this.performRevoke(principal, publicId)
  }

  private async performRevoke(
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
