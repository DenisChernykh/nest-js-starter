import { SetMetadata } from '@nestjs/common'

import type { PermissionKey } from '@/shared/application/permission'

export const REQUIRE_PERMISSION_METADATA = Symbol('auth:required-permissions')

export function RequirePermission(
  ...permissions: readonly PermissionKey[]
): MethodDecorator & ClassDecorator {
  if (new Set(permissions).size !== permissions.length)
    throw new Error('Duplicate permission requirement')
  return SetMetadata(REQUIRE_PERMISSION_METADATA, Object.freeze(permissions))
}
