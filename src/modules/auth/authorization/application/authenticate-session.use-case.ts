import { Inject, Injectable } from '@nestjs/common'

import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthenticationRequiredError,
} from '../../application/auth-errors'
import type { AuthenticatedPrincipal } from '../../public-contracts/authenticated-principal'
import { ResolveSessionIdentityQuery } from '../../sessions/application/resolve-session-identity.query'
import { RoleRegistry } from './role-registry'

/** Authenticates one opaque token against fresh durable account state. */
@Injectable()
export class AuthenticateSessionUseCase {
  public constructor(
    @Inject(ResolveSessionIdentityQuery)
    private readonly resolveSessionIdentity: ResolveSessionIdentityQuery,
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
      const identity = await this.resolveSessionIdentity.execute(
        rawToken,
        nowMs,
      )
      const permissions = this.roles.resolve(identity.status, identity.roleKeys)
      const principal = Object.freeze({
        userId: identity.userId,
        sessionId: identity.sessionId,
        normalizedEmail: identity.normalizedEmail,
        roleKeys: Object.freeze([...identity.roleKeys]),
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
