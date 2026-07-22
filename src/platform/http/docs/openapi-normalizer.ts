function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, member]) => [key, sortJsonValue(member)]),
  )
}

/**
 * Serializes a JSON-compatible value with recursively sorted object keys.
 *
 * @remarks Native JSON serialization runs first so arrays, omitted undefined
 * fields and custom JSON values retain standard JSON semantics. Array order is
 * never changed. The result contains two-space indentation and one final LF.
 *
 * @param value - JSON-compatible source value.
 * @returns Byte-stable canonical JSON text.
 * @throws TypeError when the root is not serializable JSON.
 */
export function canonicalizeJson(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError('Canonical JSON root is not serializable')
  }
  const parsed = JSON.parse(serialized) as unknown
  const canonical = JSON.stringify(sortJsonValue(parsed), undefined, 2)
  if (canonical === undefined) {
    throw new TypeError('Canonical JSON root is not serializable')
  }
  return `${canonical}\n`
}
