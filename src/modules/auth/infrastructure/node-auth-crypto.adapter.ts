import {
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from 'node:crypto'

/** Injectable cryptographic random-byte source used for deterministic tests. */
export type AuthRandomBytesSource = (size: number) => Buffer

function decodeCanonicalBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined
  const decoded = Buffer.from(value, 'base64url')
  return decoded.toString('base64url') === value ? decoded : undefined
}

/** Owns opaque identifiers, keyed digests and constant-time byte comparison. */
export class NodeAuthCryptoAdapter {
  public constructor(
    private readonly randomBytes: AuthRandomBytesSource = nodeRandomBytes,
  ) {}

  /** Generates a 256-bit opaque bearer token in canonical base64url. */
  public generateSessionToken(): string {
    return this.randomBytes(32).toString('base64url')
  }

  /** Generates an independent 128-bit public session identifier. */
  public generatePublicId(): string {
    return this.randomBytes(16).toString('base64url')
  }

  /** Generates an independent 256-bit CSRF seed. */
  public generateCsrfSeed(): string {
    return this.randomBytes(32).toString('base64url')
  }

  /** Computes a SHA-256 HMAC with the caller-owned dedicated key. */
  public hmac(key: Uint8Array, value: string): string {
    return createHmac('sha256', key).update(value, 'utf8').digest('base64url')
  }

  /** Compares equal-length canonical decoded bytes with timingSafeEqual. */
  public constantTimeEqualBase64Url(left: string, right: string): boolean {
    const leftBytes = decodeCanonicalBase64Url(left)
    const rightBytes = decodeCanonicalBase64Url(right)
    if (
      leftBytes === undefined ||
      rightBytes === undefined ||
      leftBytes.length !== rightBytes.length
    ) {
      return false
    }
    return timingSafeEqual(leftBytes, rightBytes)
  }
}
