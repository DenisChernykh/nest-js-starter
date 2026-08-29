import {
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
} from 'node:crypto'

import type { OneTimeTokenCodecPort } from '../../application/one-time-token-codec.port'

export type AccountLifecycleRandomBytesSource = (size: number) => Buffer

export class NodeAccountLifecycleCryptoAdapter implements OneTimeTokenCodecPort {
  public constructor(
    private readonly randomBytes: AccountLifecycleRandomBytesSource = nodeRandomBytes,
  ) {}

  public issue(): { readonly rawToken: string; readonly digest: string } {
    const rawToken = this.randomBytes(32).toString('base64url')
    return { rawToken, digest: this.digest(rawToken) as string }
  }

  public digest(rawToken: string): string | undefined {
    if (!/^[A-Za-z0-9_-]+$/u.test(rawToken)) return undefined
    const decoded = Buffer.from(rawToken, 'base64url')
    if (decoded.length !== 32 || decoded.toString('base64url') !== rawToken)
      return undefined
    return createHash('sha256').update(decoded).digest('base64url')
  }

  public hmac(key: Uint8Array, value: string): string {
    return createHmac('sha256', key).update(value, 'utf8').digest('base64url')
  }
}
