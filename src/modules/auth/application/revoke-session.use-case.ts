import type { AuthenticatedPrincipal } from './auth.types'
import type { SessionStorePort } from './session-store.port'

/** Revokes one public session identifier within authenticated user ownership. */
export class RevokeSessionUseCase {
  public constructor(private readonly sessions: SessionStorePort) {}

  public execute(
    principal: AuthenticatedPrincipal,
    publicId: string,
  ): Promise<boolean> {
    return this.sessions.revoke(principal.userId, publicId)
  }
}
