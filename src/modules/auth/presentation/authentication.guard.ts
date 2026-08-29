import { Injectable } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { AuthenticateSessionUseCase } from '../application/authenticate-session.use-case'
import { AuthenticationRequiredError } from '../public-contracts/auth-errors'
import { attachAuthenticatedPrincipal } from '../public-contracts/authenticated-request'
import type { AuthRequestContext } from './auth-request.context'
import { readCanonicalSessionToken } from '../sessions/presentation/session-cookie'
import { PUBLIC_ENDPOINT_METADATA } from '@/platform/http/policy/public-endpoint.decorator'

interface CookieRequest {
  readonly headers: { readonly cookie?: string }
}

/** Default-authentication global guard with an explicit public bypass. */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly authenticate: AuthenticateSessionUseCase,
    private readonly requestContext: AuthRequestContext,
    private readonly cookieName: string,
    private readonly now: () => number = Date.now,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ENDPOINT_METADATA,
      [context.getHandler(), context.getClass()],
    )
    if (isPublic === true) return true
    const request = context.switchToHttp().getRequest<CookieRequest>()
    const token = readCanonicalSessionToken(
      request.headers.cookie,
      this.cookieName,
    )
    if (token === undefined) throw new AuthenticationRequiredError()
    const principal = await this.authenticate.execute(token, this.now())
    attachAuthenticatedPrincipal(request, principal)
    this.requestContext.prepare(request, principal, token)
    return true
  }
}
