import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import { AuthenticationRequiredError } from '../application/auth-errors'
import type { AuthenticatedPrincipal } from '../application/auth.types'

const authenticatedPrincipalKey = Symbol('auth:authenticated-principal')

/**
 * Attaches the authenticated identity to exactly one request object.
 *
 * @remarks
 * The private symbol property is non-enumerable, non-configurable and
 * non-writable. Raw session state remains owned by `AuthRequestContext`.
 *
 * @param request - Concrete HTTP request admitted by the authentication guard.
 * @param principal - Fresh principal returned by session authentication.
 * @throws Error when a principal was already attached or the request is not extensible.
 */
export function attachAuthenticatedPrincipal(
  request: object,
  principal: AuthenticatedPrincipal,
): void {
  if (Object.hasOwn(request, authenticatedPrincipalKey))
    throw new Error('Authenticated principal already attached')
  Object.defineProperty(request, authenticatedPrincipalKey, {
    configurable: false,
    enumerable: false,
    value: principal,
    writable: false,
  })
}

/**
 * Reads the identity attached by the authentication guard.
 *
 * @param request - Concrete HTTP request passed to a controller parameter.
 * @returns The same authenticated principal instance attached by the guard.
 * @throws AuthenticationRequiredError when authentication did not attach a principal.
 */
export function readAuthenticatedPrincipal(
  request: object,
): AuthenticatedPrincipal {
  if (!Object.hasOwn(request, authenticatedPrincipalKey))
    throw new AuthenticationRequiredError()
  const principal = Reflect.get(request, authenticatedPrincipalKey) as
    AuthenticatedPrincipal | undefined
  if (principal === undefined) throw new AuthenticationRequiredError()
  return principal
}

/**
 * Resolves the authenticated request identity for a Nest controller parameter.
 *
 * @throws AuthenticationRequiredError when the authentication guard did not
 * attach a principal to the same request.
 */
export const CurrentPrincipal: (
  ...dataOrPipes: unknown[]
) => ParameterDecorator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal =>
    readAuthenticatedPrincipal(context.switchToHttp().getRequest<object>()),
)
