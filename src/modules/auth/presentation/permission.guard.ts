import { Injectable } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AuthorizationDeniedError } from '../application/auth-errors'
import { REQUIRE_PERMISSION_METADATA } from '../public-contracts/require-permission.decorator'
import { AuthRequestContext } from './auth-request.context'
import type { PermissionKey } from '@/shared/application/permission'

/** Enforces an all-of permission policy against the freshly loaded principal. */
@Injectable()
export class PermissionGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: AuthRequestContext,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const requirements = this.reflector.getAllAndMerge<
      readonly PermissionKey[]
    >(REQUIRE_PERMISSION_METADATA, [context.getHandler(), context.getClass()])
    if (requirements === undefined || requirements.length === 0) return true
    if (new Set(requirements).size !== requirements.length)
      throw new AuthorizationDeniedError()
    const request = context.switchToHttp().getRequest<object>()
    const { principal } = this.requestContext.preparedState(request)
    if (
      !requirements.every((permission) => principal.permissions.has(permission))
    ) {
      throw new AuthorizationDeniedError()
    }
    return true
  }
}
