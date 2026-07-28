import {
  SYSTEM_ADMIN_PERMISSIONS,
  type RoleDefinition,
} from '@/modules/auth/application/role-registry'

/** Immutable product-owned role definitions installed by the API root. */
export const API_ROLE_DEFINITIONS: readonly RoleDefinition[] = Object.freeze([
  Object.freeze({
    key: 'system.admin',
    permissions: SYSTEM_ADMIN_PERMISSIONS,
  }),
])
