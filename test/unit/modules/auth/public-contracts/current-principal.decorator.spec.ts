import * as authPublicApi from '@/modules/auth'
import {
  CurrentPrincipal,
  RequirePermission,
  type AuthenticatedPrincipal,
} from '@/modules/auth'
import { AuthenticationRequiredError as InternalAuthenticationRequiredError } from '@/modules/auth/public-contracts/auth-errors'
import {
  attachAuthenticatedPrincipal,
  readAuthenticatedPrincipal,
} from '@/modules/auth/public-contracts/authenticated-request'
import { AuthenticationRequiredError } from '@/modules/auth/public-contracts/auth-errors'

describe('CurrentPrincipal request integration', () => {
  const principal: AuthenticatedPrincipal = {
    userId: 'user',
    sessionId: 'session',
    normalizedEmail: 'user@example.com',
    roleKeys: [],
    permissions: new Set(),
  }

  it('is exposed with the permission decorator through the auth public API', () => {
    expect(Object.keys(authPublicApi).sort()).toEqual([
      'CurrentPrincipal',
      'RequirePermission',
    ])
    expect(CurrentPrincipal).toEqual(expect.any(Function))
    expect(RequirePermission).toEqual(expect.any(Function))
  })

  it('keeps the internal compatibility export on the same error constructor', () => {
    expect(InternalAuthenticationRequiredError).toBe(
      AuthenticationRequiredError,
    )
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
