/** Type-only brand applied after canonical runtime permission validation. */
export declare const permissionKeyBrand: unique symbol

/** Canonical lowercase dot-separated permission key shared by business modules. */
export type PermissionKey = string & {
  readonly [permissionKeyBrand]: true
}

const permissionPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u

/**
 * Validates and freezes a literal permission list while preserving its union.
 *
 * @param keys - Complete code-owned permission list.
 * @returns A frozen list of canonical branded permission keys.
 * @throws Error for a non-canonical key, wildcard or duplicate.
 */
export function definePermissions<const T extends string>(
  keys: readonly T[],
): readonly (T & PermissionKey)[] {
  const unique = new Set<string>()
  const validated = keys.map((key) => {
    if (!permissionPattern.test(key) || unique.has(key))
      throw new Error('Permission definition rejected')
    unique.add(key)
    return key as T & PermissionKey
  })
  return Object.freeze(validated)
}
