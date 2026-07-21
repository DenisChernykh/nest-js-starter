import { Injectable } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { AuthenticateSessionUseCase } from '../application/authenticate-session.use-case'
import { AuthenticationRequiredError } from '../application/auth-errors'
import type { AuthRequestContext } from './auth-request.context'
import { PUBLIC_ENDPOINT_METADATA } from '@/platform/http/policy/public-endpoint.decorator'

interface CookieRequest {
  readonly headers: { readonly cookie?: string }
}

function readCanonicalToken(
  cookieHeader: string | undefined,
  cookieName: string,
): string | undefined {
  if (cookieHeader === undefined) return undefined
  const values = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${cookieName}=`))
    .map((entry) => entry.slice(cookieName.length + 1))
  if (values.length !== 1) return undefined
  const token = values[0]
  if (token === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(token))
    return undefined
  const decoded = Buffer.from(token, 'base64url')
  return decoded.length === 32 && decoded.toString('base64url') === token
    ? token
    : undefined
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
    const token = readCanonicalToken(request.headers.cookie, this.cookieName)
    if (token === undefined) throw new AuthenticationRequiredError()
    const principal = await this.authenticate.execute(token, this.now())
    this.requestContext.prepare(request, principal, token)
    return true
  }
}
