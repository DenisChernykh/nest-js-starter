import { Inject, Injectable } from '@nestjs/common'

import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthenticationRequiredError,
} from '../../application/auth-errors'
import {
  IDENTITY_SECURITY_STATE,
  type IdentitySecurityStatePort,
} from '../../identity/application/identity-security-state.port'
import type { UserStatus } from '../../identity/domain/user-status'
import { SESSION_STORE, type SessionStorePort } from './session-store.port'

export interface ResolvedSessionIdentity {
  readonly userId: string
  readonly sessionId: string
  readonly normalizedEmail: string
  readonly status: UserStatus
  readonly roleKeys: readonly string[]
}

@Injectable()
export class ResolveSessionIdentityQuery {
  public constructor(
    @Inject(SESSION_STORE)
    private readonly sessions: SessionStorePort,
    @Inject(IDENTITY_SECURITY_STATE)
    private readonly identity: IdentitySecurityStatePort,
  ) {}

  public async execute(
    rawToken: string,
    nowMs: number,
  ): Promise<ResolvedSessionIdentity> {
    try {
      const record = await this.sessions.readAndTouch(rawToken, nowMs)
      if (record === undefined) throw new AuthenticationRequiredError()
      const [projection, epoch] = await Promise.all([
        this.identity.findAuthProjectionByUserId(record.userId),
        this.identity.readGlobalSessionEpoch(),
      ])
      if (
        projection === undefined ||
        projection.sessionGeneration.toString(10) !==
          record.sessionGeneration ||
        epoch.toString(10) !== record.globalSessionEpoch
      ) {
        throw new AuthenticationRequiredError()
      }
      return Object.freeze({
        userId: projection.userId,
        sessionId: record.publicId,
        normalizedEmail: projection.normalizedEmail,
        status: projection.status,
        roleKeys: Object.freeze([...projection.roleKeys]),
      })
    } catch (error: unknown) {
      if (error instanceof AuthenticationRequiredError) throw error
      if (error instanceof AuthDependencyUnavailableError) throw error
      if (error instanceof AuthError) throw new AuthenticationRequiredError()
      throw new AuthDependencyUnavailableError()
    }
  }
}
