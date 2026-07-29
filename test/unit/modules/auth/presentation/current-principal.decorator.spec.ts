import { CurrentPrincipal, RequirePermission } from '@/modules/auth'
import { AuthenticationRequiredError } from '@/modules/auth/application/auth-errors'
import type { AuthenticatedPrincipal } from '@/modules/auth/application/auth.types'
import {
  attachAuthenticatedPrincipal,
  readAuthenticatedPrincipal,
} from '@/modules/auth/presentation/current-principal.decorator'

describe('CurrentPrincipal request integration', () => {
  const principal: AuthenticatedPrincipal = {
    userId: 'user',
    sessionId: 'session',
    normalizedEmail: 'user@example.com',
    roleKeys: [],
    permissions: new Set(),
  }

  it('is exposed with the permission decorator through the auth public API', () => {
    expect(CurrentPrincipal).toEqual(expect.any(Function))
    expect(RequirePermission).toEqual(expect.any(Function))
  })

  it('stores one immutable non-enumerable principal and reads it back', () => {
    const request = {}

    attachAuthenticatedPrincipal(request, principal)

    expect(Object.keys(request)).toEqual([])
    expect(readAuthenticatedPrincipal(request)).toBe(principal)

    const principalKey = Reflect.ownKeys(request)[0]
    expect(principalKey).toEqual(expect.any(Symbol))
    expect(
      Object.getOwnPropertyDescriptor(request, principalKey!),
    ).toMatchObject({
      configurable: false,
      enumerable: false,
      value: principal,
      writable: false,
    })
    expect(() => attachAuthenticatedPrincipal(request, principal)).toThrow()
  })

  it('fails closed when no guard attached a principal', () => {
    expect(() => readAuthenticatedPrincipal({})).toThrow(
      AuthenticationRequiredError,
    )
  })

  it('does not inherit a principal from another request object', () => {
    const authenticatedRequest = {}
    attachAuthenticatedPrincipal(authenticatedRequest, principal)

    expect(() =>
      readAuthenticatedPrincipal(Object.create(authenticatedRequest) as object),
    ).toThrow(AuthenticationRequiredError)
  })
})
