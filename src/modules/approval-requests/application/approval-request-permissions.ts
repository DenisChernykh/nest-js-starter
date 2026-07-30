import { definePermissions } from '@/shared/application/permission'
import type { PermissionKey } from '@/shared/application/permission'

/** Complete frozen permission list owned by the approval request module. */
export const APPROVAL_REQUEST_PERMISSIONS: readonly PermissionKey[] =
  definePermissions(['approval.requests.read', 'approval.requests.decide'])

/** Permission granting read access to approval requests owned by other users. */
export const APPROVAL_REQUEST_READ_PERMISSION: PermissionKey =
  APPROVAL_REQUEST_PERMISSIONS[0]!

/** Permission granting access to the terminal decision operation. */
export const APPROVAL_REQUEST_DECIDE_PERMISSION: PermissionKey =
  APPROVAL_REQUEST_PERMISSIONS[1]!
