import { DisabledUserError, UnknownRoleAssignmentError } from './auth-errors'
import { definePermissions, type PermissionKey } from './permission'
import type { UserStatus } from '../domain/user-status'

/** Immutable code-owned mapping from one durable role to explicit permissions. */
export interface RoleDefinition {
  readonly key: string
  readonly permissions: readonly PermissionKey[]
}

/** Explicit permissions held by the built-in initial administrator role. */
export const SYSTEM_ADMIN_PERMISSIONS: readonly PermissionKey[] =
  definePermissions(['system.docs.read'])

/** Built-in administrator role with no wildcard or implicit bypass. */
export const SYSTEM_ADMIN_ROLE: RoleDefinition = Object.freeze({
  key: 'system.admin',
  permissions: SYSTEM_ADMIN_PERMISSIONS,
})

/** Creates the immutable registry used by the auth composition root. */
export function createAuthRoleRegistry(): RoleRegistry {
  return new RoleRegistry([SYSTEM_ADMIN_ROLE])
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
}
