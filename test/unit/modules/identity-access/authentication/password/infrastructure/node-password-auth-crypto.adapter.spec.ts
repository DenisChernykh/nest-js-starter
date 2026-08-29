import { NodePasswordAuthCryptoAdapter } from '@/modules/identity-access/authentication/infrastructure/node-password-auth-crypto.adapter'

describe('NodePasswordAuthCryptoAdapter', () => {
  it('computes deterministic HMACs with the caller-owned login key', () => {
    const crypto = new NodePasswordAuthCryptoAdapter()
    const key = Buffer.alloc(32, 3)

    expect(crypto.hmac(key, 'account:user@example.com')).toBe(
      crypto.hmac(key, 'account:user@example.com'),
    )
    expect(
      crypto.hmac(Buffer.alloc(32, 4), 'account:user@example.com'),
    ).not.toBe(crypto.hmac(key, 'account:user@example.com'))
  })
})
