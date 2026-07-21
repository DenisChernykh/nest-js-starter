import { randomUUID } from 'node:crypto'

const canonicalUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const canonicalUlid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u

/** Canonical response header used for request correlation. */
export const REQUEST_ID_HEADER = 'X-Request-ID'

/** Result of applying the inbound request-ID trust policy. */
export interface ResolvedRequestId {
  readonly requestId: string
  readonly accepted: boolean
}

/**
 * Accepts one canonical UUID or uppercase ULID and replaces any other value.
 *
 * @param headerValue - Untrusted raw header value from the HTTP adapter.
 * @param generate - UUID generator injected by tests when deterministic output is required.
 * @returns A trusted identifier and whether the inbound value was accepted.
 */
export function resolveRequestId(
  headerValue: unknown,
  generate: () => string = randomUUID,
): ResolvedRequestId {
  const accepted =
    typeof headerValue === 'string' &&
    (canonicalUuid.test(headerValue) || canonicalUlid.test(headerValue))
  return Object.freeze({
    requestId: accepted ? headerValue : generate(),
    accepted,
  })
}
