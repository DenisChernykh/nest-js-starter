import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { PermissionKey } from '@/modules/auth/application/permission'
import { AuthorizationDeniedError } from '@/modules/auth/application/auth-errors'
import { AuthRequestContext } from '@/modules/auth/presentation/auth-request.context'
import { PermissionGuard } from '@/modules/auth/presentation/permission.guard'
import {
  REQUIRE_PERMISSION_METADATA,
  RequirePermission,
} from '@/modules/auth/public-contracts/require-permission.decorator'

const read = 'catalog.read' as PermissionKey
const write = 'catalog.write' as PermissionKey

function context(
  request: object,
  handler: () => void = () => undefined,
  controller: abstract new (...args: never[]) => unknown = class Controller {},
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

describe('PermissionGuard', () => {
  it('allows an endpoint without permission requirements', () => {
    const guard = new PermissionGuard(new Reflector(), new AuthRequestContext())

    expect(guard.canActivate(context({}))).toBe(true)
  })

  it('requires every declared permission', () => {
    const request = {}
    const requestContext = new AuthRequestContext()
    requestContext.prepare(
      request,
      {
        userId: 'user',
        sessionId: 'session',
        normalizedEmail: 'user@example.com',
        roleKeys: [],
        permissions: new Set([read, write]),
      },
      'token',
    )
    const handler = (): void => undefined
    Reflect.defineMetadata(REQUIRE_PERMISSION_METADATA, [read, write], handler)
    const guard = new PermissionGuard(new Reflector(), requestContext)

    expect(guard.canActivate(context(request, handler))).toBe(true)
  })

  it('denies when one declared permission is missing', () => {
    const request = {}
    const requestContext = new AuthRequestContext()
    requestContext.prepare(
      request,
      {
        userId: 'user',
        sessionId: 'session',
        normalizedEmail: 'user@example.com',
        roleKeys: [],
        permissions: new Set([read]),
      },
      'token',
    )
    const handler = (): void => undefined
    Reflect.defineMetadata(REQUIRE_PERMISSION_METADATA, [read, write], handler)
    const guard = new PermissionGuard(new Reflector(), requestContext)

    expect(() => guard.canActivate(context(request, handler))).toThrow(
      AuthorizationDeniedError,
    )
  })

  it('rejects duplicate permission metadata across class and handler', () => {
    const request = {}
    const requestContext = new AuthRequestContext()
    const controller = class Controller {}
    const handler = (): void => undefined
    Reflect.defineMetadata(REQUIRE_PERMISSION_METADATA, [read], controller)
    Reflect.defineMetadata(REQUIRE_PERMISSION_METADATA, [read], handler)
    const guard = new PermissionGuard(new Reflector(), requestContext)

    expect(() =>
      guard.canActivate(context(request, handler, controller)),
    ).toThrow(AuthorizationDeniedError)
  })

  it('rejects duplicate inputs when declaring metadata', () => {
    expect(() => RequirePermission(read, read)).toThrow(
      'Duplicate permission requirement',
    )
  })
})
