/**
 * Reads one canonical opaque session token from a raw Cookie header.
 *
 * @param cookieHeader - Untrusted Cookie header bytes decoded as a string.
 * @param cookieName - Runtime-configured browser session cookie name.
 * @returns A canonical 32-byte base64url token, or undefined on any ambiguity.
 */
export function readCanonicalSessionToken(
  cookieHeader: string | undefined,
  cookieName: string,
): string | undefined {
  if (cookieHeader === undefined) return undefined
  const values = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${cookieName}=`))
    .map((entry) => entry.slice(cookieName.length + 1))
  if (values.length !== 1) return undefined
  const token = values[0]
  if (token === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    return undefined
  }
  const decoded = Buffer.from(token, 'base64url')
  return decoded.length === 32 && decoded.toString('base64url') === token
    ? token
    : undefined
}
