import {
  DisabledUserError,
  UnknownRoleAssignmentError,
} from '../../application/auth-errors'
import { definePermissions } from './permission'
import type { UserStatus } from '../../identity/domain/user-status'
import type { PermissionKey } from '@/shared/application/permission'

/** Immutable code-owned mapping from one durable role to explicit permissions. */
export interface RoleDefinition {
  readonly key: string
  readonly permissions: readonly PermissionKey[]
}

export const AUTH_ACCOUNTS_READ_PERMISSION: PermissionKey = definePermissions([
  'auth.accounts.read',
])[0]!
export const AUTH_ACCOUNTS_MANAGE_PERMISSION: PermissionKey = definePermissions(
  ['auth.accounts.manage'],
)[0]!
export const AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION: PermissionKey =
  definePermissions(['auth.accounts.roles.manage'])[0]!

/** Explicit permissions held by the built-in initial administrator role. */
export const SYSTEM_ADMIN_PERMISSIONS: readonly PermissionKey[] =
  definePermissions([
    'system.docs.read',
    AUTH_ACCOUNTS_READ_PERMISSION,
    AUTH_ACCOUNTS_MANAGE_PERMISSION,
    AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
  ])

/**
 * Creates the immutable registry from the product-owned role catalog.
 *
 * @param definitions - Complete role definitions supplied by the composition root.
 * @returns A registry with no implicit roles or wildcard permissions.
 */
export function createAuthRoleRegistry(
  definitions: readonly RoleDefinition[],
): RoleRegistry {
  return new RoleRegistry(definitions)
}

class ImmutablePermissionSet implements ReadonlySet<PermissionKey> {
  private readonly valuesSet: Set<PermissionKey>

  public constructor(values: readonly PermissionKey[]) {
    this.valuesSet = new Set(values)
  }

  public get size(): number {
    return this.valuesSet.size
  }

  public has(value: PermissionKey): boolean {
    return this.valuesSet.has(value)
  }

  public entries(): SetIterator<[PermissionKey, PermissionKey]> {
    return this.valuesSet.entries()
  }

  public keys(): SetIterator<PermissionKey> {
    return this.valuesSet.keys()
  }

  public values(): SetIterator<PermissionKey> {
    return this.valuesSet.values()
  }

  public forEach(
    callbackfn: (
      value: PermissionKey,
      value2: PermissionKey,
      set: ReadonlySet<PermissionKey>,
    ) => void,
    thisArg?: unknown,
  ): void {
    for (const value of this.valuesSet)
      callbackfn.call(thisArg, value, value, this)
  }

  public [Symbol.iterator](): SetIterator<PermissionKey> {
    return this.valuesSet[Symbol.iterator]()
  }
}

const rolePattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u

/** Resolves durable role assignments through duplicate-safe code definitions. */
export class RoleRegistry {
  private readonly roles = new Map<string, readonly PermissionKey[]>()

  public constructor(definitions: readonly RoleDefinition[]) {
    for (const definition of definitions) {
      if (!rolePattern.test(definition.key) || this.roles.has(definition.key))
        throw new Error('Role definition rejected')
      if (
        new Set(definition.permissions).size !== definition.permissions.length
      )
        throw new Error('Role permission definition contains duplicates')
      this.roles.set(definition.key, Object.freeze([...definition.permissions]))
    }
  }

  /**
   * Returns a sorted immutable permission union for one active account.
   *
   * @throws DisabledUserError for a disabled account.
   * @throws UnknownRoleAssignmentError for any role absent from code.
   */
  public resolve(
    status: UserStatus,
    roleKeys: readonly string[],
  ): ReadonlySet<PermissionKey> {
    if (status === 'disabled') throw new DisabledUserError()
    const permissions = new Set<PermissionKey>()
    for (const roleKey of roleKeys) {
      const rolePermissions = this.roles.get(roleKey)
      if (rolePermissions === undefined) throw new UnknownRoleAssignmentError()
      for (const permission of rolePermissions) permissions.add(permission)
    }
    return Object.freeze(new ImmutablePermissionSet([...permissions].sort()))
  }

  public hasRole(roleKey: string): boolean {
    return this.roles.has(roleKey)
  }

  public roleKeysGranting(permission: PermissionKey): readonly string[] {
    return Object.freeze(
      [...this.roles.entries()]
        .filter(([, permissions]) => permissions.includes(permission))
        .map(([roleKey]) => roleKey)
        .sort(),
    )
  }

  public listRoles(): readonly RoleDefinition[] {
    return Object.freeze(
      [...this.roles.entries()]
        .map(([key, permissions]) =>
          Object.freeze({ key, permissions: Object.freeze([...permissions]) }),
        )
        .sort((left, right) => left.key.localeCompare(right.key)),
    )
  }
}
