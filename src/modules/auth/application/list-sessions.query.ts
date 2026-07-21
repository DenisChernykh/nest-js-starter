import type { AuthenticatedPrincipal } from './auth.types'
import type {
  BrowserSessionSummary,
  SessionStorePort,
} from './session-store.port'

/** Lists safe session metadata for the authenticated owner only. */
export class ListSessionsQuery {
  public constructor(private readonly sessions: SessionStorePort) {}

  public execute(
    principal: AuthenticatedPrincipal,
  ): Promise<readonly BrowserSessionSummary[]> {
    return this.sessions.list(principal.userId, principal.sessionId)
  }
}
