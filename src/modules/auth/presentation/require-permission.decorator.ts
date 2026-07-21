import { SetMetadata } from '@nestjs/common'

import type { PermissionKey } from '../application/permission'

/** Metadata key containing the complete permission conjunction for an endpoint. */
export const REQUIRE_PERMISSION_METADATA = Symbol('auth:required-permissions')

/**
 * Requires every listed permission after fresh session authentication.
 *
 * @throws Error when the declaration itself contains a duplicate key.
 */
export function RequirePermission(
  ...permissions: readonly PermissionKey[]
): MethodDecorator & ClassDecorator {
  if (new Set(permissions).size !== permissions.length)
    throw new Error('Duplicate permission requirement')
  return SetMetadata(REQUIRE_PERMISSION_METADATA, Object.freeze(permissions))
}
