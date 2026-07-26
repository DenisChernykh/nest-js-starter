/** Successful or rejected decode without an unchecked generic cast. */
export type RedisDecodeResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false }

/** Explicit serialization and validation boundary for one Redis value type. */
export interface RedisCodec<T> {
  /** Serializes one already-validated application value. */
  encode(value: T): string
  /** Parses and validates untrusted Redis bytes. */
  decode(serialized: string): RedisDecodeResult<T>
}

/**
 * Creates a JSON codec whose caller-supplied guard validates every Redis read.
 *
 * @param isValue - Runtime type guard owned by the consuming module.
 * @returns A codec that reports malformed JSON and guard failures as invalid.
 */
export function createJsonRedisCodec<T>(
  isValue: (value: unknown) => value is T,
): RedisCodec<T> {
  return {
    encode: (value) => {
      const encoded = JSON.stringify(value)
      if (encoded === undefined)
        throw new Error('Redis codec cannot serialize this value')
      return encoded
    },
    decode: (serialized) => {
      try {
        const parsed: unknown = JSON.parse(serialized)
        return isValue(parsed) ? { ok: true, value: parsed } : { ok: false }
      } catch {
        return { ok: false }
      }
    },
  }
}
