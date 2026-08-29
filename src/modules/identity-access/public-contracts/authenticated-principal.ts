import type { PermissionKey } from '@/shared/application/permission'

export interface AuthenticatedPrincipal {
  readonly userId: string
  readonly sessionId: string
  readonly normalizedEmail: string
  readonly roleKeys: readonly string[]
  readonly permissions: ReadonlySet<PermissionKey>
}
