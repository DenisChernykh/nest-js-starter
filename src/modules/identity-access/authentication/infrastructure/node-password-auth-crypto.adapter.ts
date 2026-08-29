import { createHmac } from 'node:crypto'

export class NodePasswordAuthCryptoAdapter {
  public hmac(key: Uint8Array, value: string): string {
    return createHmac('sha256', key).update(value, 'utf8').digest('base64url')
  }
}
