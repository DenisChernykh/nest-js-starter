import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { GetCsrfTokenQuery } from '@/modules/auth/sessions/application/get-csrf-token.query'
import { AuthRequestContext } from '@/modules/auth/authorization/presentation/auth-request.context'
import type { AuthenticatedPrincipal } from '@/modules/auth/public-contracts/authenticated-principal'
import { CSRF_TOKEN_EXEMPT_METADATA } from '@/modules/auth/public-contracts/csrf-token-exempt.decorator'
import {
  SessionCsrfGuard,
  type CsrfTokenComparator,
} from '@/modules/auth/authorization/presentation/session-csrf.guard'

function context(
  request: object,
  method: string,
  headers: Record<string, string> = {},
  handler: () => void = () => undefined,
): ExecutionContext {
  Object.assign(request, { method, headers })
  return {
    getHandler: () => handler,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

describe('SessionCsrfGuard', () => {
  const principal: AuthenticatedPrincipal = {
    userId: 'user',
    sessionId: 'session',
    normalizedEmail: 'user@example.com',
    roleKeys: [],
    permissions: new Set(),
  }

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'allows safe method %s',
    async (method) => {
      const query = { execute: jest.fn() } as unknown as GetCsrfTokenQuery
      const guard = new SessionCsrfGuard(
        new Reflector(),
        new AuthRequestContext(),
        query,
      )

      await expect(guard.canActivate(context({}, method))).resolves.toBe(true)
    },
  )

  it('allows login token-only exemption but not other CSRF policy guards', async () => {
    const handler = (): void => undefined
    Reflect.defineMetadata(CSRF_TOKEN_EXEMPT_METADATA, true, handler)
    const query = { execute: jest.fn() } as unknown as GetCsrfTokenQuery
    const guard = new SessionCsrfGuard(
      new Reflector(),
      new AuthRequestContext(),
      query,
    )

    await expect(
      guard.canActivate(context({}, 'POST', {}, handler)),
    ).resolves.toBe(true)
  })

  it('revalidates the session token and compares the CSRF header', async () => {
    const request = {}
    const requestContext = new AuthRequestContext()
    requestContext.prepare(request, principal, 'raw-session-token')
    const query = {
      execute: jest.fn(() => Promise.resolve({ csrfToken: 'expected' })),
    } as unknown as GetCsrfTokenQuery
    const comparator = jest.fn(() => true)
    const guard = new SessionCsrfGuard(
      new Reflector(),
      requestContext,
      query,
      comparator,
      () => 123,
    )

    await expect(
      guard.canActivate(
        context(request, 'DELETE', { 'x-csrf-token': 'provided' }),
      ),
    ).resolves.toBe(true)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(query.execute).toHaveBeenCalledWith('raw-session-token', 123)
    expect(comparator).toHaveBeenCalledWith('provided', 'expected')
  })

  it.each([undefined, 'wrong'])(
    'rejects missing or wrong token %j',
    async (token) => {
      const request = {}
      const requestContext = new AuthRequestContext()
      requestContext.prepare(request, principal, 'raw-session-token')
      const query = {
        execute: jest.fn(() => Promise.resolve({ csrfToken: 'expected' })),
      } as unknown as GetCsrfTokenQuery
      const comparator: CsrfTokenComparator = (left, right) => left === right
      const guard = new SessionCsrfGuard(
        new Reflector(),
        requestContext,
        query,
        comparator,
      )

      await expect(
        guard.canActivate(
          context(
            request,
            'POST',
            token === undefined ? {} : { 'x-csrf-token': token },
          ),
        ),
      ).rejects.toMatchObject({ code: 'AUTH_CSRF_REJECTED' })
    },
  )
})
