/** Returns disabled trust or an immutable exact CIDR allowlist. */
export function trustedProxySetting(
  cidrs: readonly string[],
): false | readonly string[] {
  return cidrs.length === 0 ? false : Object.freeze([...cidrs])
}
