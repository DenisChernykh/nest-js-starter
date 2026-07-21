import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { AuthenticateSessionUseCase } from '@/modules/auth/application/authenticate-session.use-case'
import { AuthDependencyUnavailableError } from '@/modules/auth/application/auth-errors'
import { AuthRequestContext } from '@/modules/auth/presentation/auth-request.context'
import { AuthenticationGuard } from '@/modules/auth/presentation/authentication.guard'
import { PUBLIC_ENDPOINT_METADATA } from '@/platform/http/policy/public-endpoint.decorator'

function context(
  cookie?: string,
  handler: () => void = () => undefined,
): ExecutionContext {
  const request = { headers: cookie === undefined ? {} : { cookie } }
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext
}

describe('AuthenticationGuard', () => {
  const principal = {
    userId: 'user',
    sessionId: 'session',
    normalizedEmail: 'user@example.com',
    roleKeys: [],
    permissions: new Set(),
  }

  it.each([
    undefined,
    'nest-js-starter-session=short',
    `nest-js-starter-session=${'A'.repeat(43)}; nest-js-starter-session=${'B'.repeat(43)}`,
  ])('rejects absent, malformed or duplicate cookie %j', async (cookie) => {
    const authenticate = {
      execute: jest.fn(() => Promise.resolve(principal)),
    } as unknown as AuthenticateSessionUseCase
    const guard = new AuthenticationGuard(
      new Reflector(),
      authenticate,
      new AuthRequestContext(),
      'nest-js-starter-session',
    )

    await expect(guard.canActivate(context(cookie))).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(authenticate.execute).not.toHaveBeenCalled()
  })

  it('bypasses only explicit public metadata', async () => {
    const handler = (): void => undefined
    Reflect.defineMetadata(PUBLIC_ENDPOINT_METADATA, true, handler)
    const authenticate = {
      execute: jest.fn(),
    } as unknown as AuthenticateSessionUseCase
    const guard = new AuthenticationGuard(
      new Reflector(),
      authenticate,
      new AuthRequestContext(),
      'nest-js-starter-session',
    )

    await expect(guard.canActivate(context(undefined, handler))).resolves.toBe(
      true,
    )
  })

  it('authenticates a canonical token and populates async request context', async () => {
    const authenticate = {
      execute: jest.fn(() => Promise.resolve(principal)),
    } as unknown as AuthenticateSessionUseCase
    const requestContext = new AuthRequestContext()
    const guard = new AuthenticationGuard(
      new Reflector(),
      authenticate,
      requestContext,
      'nest-js-starter-session',
      () => 123,
    )

    const executionContext = context(
      `nest-js-starter-session=${'A'.repeat(43)}`,
    )
    await expect(guard.canActivate(executionContext)).resolves.toBe(true)
    const request = executionContext.switchToHttp().getRequest<object>()
    expect(
      requestContext.run(request, () => ({
        principal: requestContext.principal,
        rawToken: requestContext.rawToken,
      })),
    ).toEqual({ principal, rawToken: 'A'.repeat(43) })
  })

  it('preserves a typed dependency failure from session authentication', async () => {
    const authenticate = {
      execute: jest.fn(() =>
        Promise.reject(new AuthDependencyUnavailableError()),
      ),
    } as unknown as AuthenticateSessionUseCase
    const guard = new AuthenticationGuard(
      new Reflector(),
      authenticate,
      new AuthRequestContext(),
      'nest-js-starter-session',
    )

    await expect(
      guard.canActivate(context(`nest-js-starter-session=${'A'.repeat(43)}`)),
    ).rejects.toMatchObject({ code: 'AUTH_DEPENDENCY_UNAVAILABLE' })
  })
})
