import { createHash } from 'node:crypto'

import { NodeAccountLifecycleCryptoAdapter } from '@/modules/identity-access/account-lifecycle/infrastructure/node-account-lifecycle-crypto.adapter'

describe('NodeAccountLifecycleCryptoAdapter', () => {
  it('issues deterministic canonical tokens and digests decoded bytes', () => {
    const randomBytes = jest.fn((size: number) => Buffer.alloc(size, 9))
    const crypto = new NodeAccountLifecycleCryptoAdapter(randomBytes)

    const issued = crypto.issue()

    expect(issued).toEqual({
      rawToken: Buffer.alloc(32, 9).toString('base64url'),
      digest: createHash('sha256')
        .update(Buffer.alloc(32, 9))
        .digest('base64url'),
    })
    expect(issued.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(issued.digest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(randomBytes).toHaveBeenCalledWith(32)
  })

  it('accepts only canonical 32-byte raw tokens', () => {
    const crypto = new NodeAccountLifecycleCryptoAdapter()
    const canonical = Buffer.alloc(32, 1).toString('base64url')

    expect(crypto.digest(canonical)).toBeDefined()
    expect(crypto.digest(`${canonical}=`)).toBeUndefined()
    expect(crypto.digest('not a token')).toBeUndefined()
    expect(
      crypto.digest(Buffer.alloc(31, 1).toString('base64url')),
    ).toBeUndefined()
    expect(
      crypto.digest(Buffer.alloc(33, 1).toString('base64url')),
    ).toBeUndefined()
  })

  it('uses the caller-owned public-account HMAC key', () => {
    const crypto = new NodeAccountLifecycleCryptoAdapter()
    const first = crypto.hmac(Buffer.alloc(32, 5), 'payload')
    const second = crypto.hmac(Buffer.alloc(32, 6), 'payload')

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(second).not.toBe(first)
  })
})
