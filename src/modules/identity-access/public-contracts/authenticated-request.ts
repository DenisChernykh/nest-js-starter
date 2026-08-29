import { AuthenticationRequiredError } from './auth-errors'
import type { AuthenticatedPrincipal } from './authenticated-principal'

const authenticatedPrincipalKey = Symbol('auth:authenticated-principal')

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
