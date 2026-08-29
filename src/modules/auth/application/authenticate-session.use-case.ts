import { Inject, Injectable } from '@nestjs/common'

import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthenticationRequiredError,
} from './auth-errors'
import type { AuthenticatedPrincipal } from '../public-contracts/authenticated-principal'
import {
  IDENTITY_SECURITY_STATE,
  type IdentitySecurityStatePort,
} from './identity-security-state.port'
import { RoleRegistry } from './role-registry'
import { SESSION_STORE, type SessionStorePort } from './session-store.port'

/** Authenticates one opaque token against fresh durable account state. */
@Injectable()
export class AuthenticateSessionUseCase {
  public constructor(
    @Inject(SESSION_STORE)
    private readonly sessions: SessionStorePort,
    @Inject(IDENTITY_SECURITY_STATE)
    private readonly identity: IdentitySecurityStatePort,
    private readonly roles: RoleRegistry,
  ) {}

  public async execute(
    rawToken: string,
    nowMs: number,
  ): Promise<AuthenticatedPrincipal> {
    return this.performAuthentication(rawToken, nowMs)
  }

  private async performAuthentication(
    rawToken: string,
    nowMs: number,
  ): Promise<AuthenticatedPrincipal> {
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
      const permissions = this.roles.resolve(
        projection.status,
        projection.roleKeys,
      )
      const principal = Object.freeze({
        userId: projection.userId,
        sessionId: record.publicId,
        normalizedEmail: projection.normalizedEmail,
        roleKeys: Object.freeze([...projection.roleKeys]),
        permissions,
      })
      return principal
    } catch (error: unknown) {
      if (error instanceof AuthenticationRequiredError) {
        throw error
      }
      if (error instanceof AuthDependencyUnavailableError) {
        throw error
      }
      if (error instanceof AuthError) {
        throw new AuthenticationRequiredError()
      }
      throw new AuthDependencyUnavailableError()
    }
  }
}
