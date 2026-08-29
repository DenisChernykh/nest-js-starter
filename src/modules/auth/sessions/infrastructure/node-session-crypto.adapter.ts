import { createHmac, randomBytes as nodeRandomBytes } from 'node:crypto'

export type SessionRandomBytesSource = (size: number) => Buffer

export class NodeSessionCryptoAdapter {
  public constructor(
    private readonly randomBytes: SessionRandomBytesSource = nodeRandomBytes,
  ) {}

  public generateSessionToken(): string {
    return this.randomBytes(32).toString('base64url')
  }

  public generatePublicId(): string {
    return this.randomBytes(16).toString('base64url')
  }

  public generateCsrfSeed(): string {
    return this.randomBytes(32).toString('base64url')
  }

  public hmac(key: Uint8Array, value: string): string {
    return createHmac('sha256', key).update(value, 'utf8').digest('base64url')
  }
}
