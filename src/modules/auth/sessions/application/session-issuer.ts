import { Inject, Injectable } from '@nestjs/common'

import {
  IDENTITY_SECURITY_STATE,
  type IdentitySecurityStatePort,
} from '../../identity/application/identity-security-state.port'
import {
  SESSION_STORE,
  type IssuedBrowserSession,
  type SessionStorePort,
} from './session-store.port'
import {
  AuthDependencyUnavailableError,
  AuthenticationFailedError,
} from '../../application/auth-errors'

export interface IssueBrowserSessionInput {
  readonly userId: string
  readonly nowMs: number
  readonly deviceLabel: string
  readonly networkFingerprint: string
}

@Injectable()
export class SessionIssuer {
  public constructor(
    @Inject(IDENTITY_SECURITY_STATE)
    private readonly identity: IdentitySecurityStatePort,
    @Inject(SESSION_STORE)
    private readonly sessions: SessionStorePort,
  ) {}

  public async issue(
    input: IssueBrowserSessionInput,
  ): Promise<IssuedBrowserSession> {
    try {
      const [projection, globalSessionEpoch] = await Promise.all([
        this.identity.findAuthProjectionByUserId(input.userId),
        this.identity.readGlobalSessionEpoch(),
      ])
      if (projection === undefined || projection.status !== 'active')
        throw new AuthenticationFailedError()
      return await this.sessions.issue({
        userId: projection.userId,
        sessionGeneration: projection.sessionGeneration,
        globalSessionEpoch,
        nowMs: input.nowMs,
        deviceLabel: input.deviceLabel,
        networkFingerprint: input.networkFingerprint,
      })
    } catch (error: unknown) {
      if (error instanceof AuthenticationFailedError) throw error
      if (error instanceof AuthDependencyUnavailableError) throw error
      throw new AuthDependencyUnavailableError()
    }
  }
}
