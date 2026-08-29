import { Inject, Injectable } from '@nestjs/common'

import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditPort,
} from '../../application/auth-audit.port'
import { SESSION_STORE, type SessionStorePort } from './session-store.port'

/** Revokes the authenticated browser session by its public identifier. */
@Injectable()
export class LogoutUseCase {
  public constructor(
    @Inject(SESSION_STORE)
    private readonly sessions: SessionStorePort,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  /** Returns whether an owned session existed; repeated logout stays safe. */
  public async execute(userId: string, sessionId: string): Promise<boolean> {
    try {
      const existed = await this.sessions.revoke(userId, sessionId)
      this.audit.emit({
        action: 'logout',
        outcome: 'success',
        reasonCode: 'LOGOUT_COMPLETED',
        actorId: userId,
        sessionId,
        targetType: 'session',
        targetId: sessionId,
      })
      return existed
    } catch (error: unknown) {
      this.audit.emit({
        action: 'logout',
        outcome: 'denied',
        reasonCode: 'DEPENDENCY_UNAVAILABLE',
        actorId: userId,
        sessionId,
        targetType: 'session',
        targetId: sessionId,
      })
      throw error
    }
  }
}
