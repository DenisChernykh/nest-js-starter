import type { SessionStorePort } from './session-store.port'

/** Revokes the authenticated browser session by its public identifier. */
export class LogoutUseCase {
  public constructor(private readonly sessions: SessionStorePort) {}

  /** Returns whether an owned session existed; repeated logout stays safe. */
  public execute(userId: string, sessionId: string): Promise<boolean> {
    return this.sessions.revoke(userId, sessionId)
  }
}
