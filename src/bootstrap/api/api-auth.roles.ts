import {
  SYSTEM_ADMIN_PERMISSIONS,
  type RoleDefinition,
} from '@/modules/identity-access/composition/role-catalog'
import { APPROVAL_REQUEST_PERMISSIONS } from '@/modules/approval-requests/composition/approval-request-role.contribution'

/** Immutable product-owned role definitions installed by the API root. */
export const API_ROLE_DEFINITIONS: readonly RoleDefinition[] = Object.freeze([
  Object.freeze({
    key: 'system.admin',
    permissions: Object.freeze([
      ...SYSTEM_ADMIN_PERMISSIONS,
      ...APPROVAL_REQUEST_PERMISSIONS,
    ]),
  }),
  Object.freeze({
    key: 'approval.reviewer',
    permissions: Object.freeze([...APPROVAL_REQUEST_PERMISSIONS]),
  }),
])
