import { Inject, Injectable } from '@nestjs/common'

import type { AuthenticatedPrincipal } from './auth.types'
import type { BrowserSessionSummary } from './session-store.port'
import { SESSION_STORE, type SessionStorePort } from './session-store.port'

/** Lists safe session metadata for the authenticated owner only. */
@Injectable()
export class ListSessionsQuery {
  public constructor(
    @Inject(SESSION_STORE) private readonly sessions: SessionStorePort,
  ) {}

  public execute(
    principal: AuthenticatedPrincipal,
  ): Promise<readonly BrowserSessionSummary[]> {
    return this.sessions.list(principal.userId, principal.sessionId)
  }
}
