import { NodeSessionCryptoAdapter } from '@/modules/auth/sessions/infrastructure/node-session-crypto.adapter'

describe('NodeSessionCryptoAdapter', () => {
  it('generates independent opaque values from deterministic random bytes', () => {
    let byte = 0
    const randomBytes = jest.fn((size: number) => Buffer.alloc(size, ++byte))
    const crypto = new NodeSessionCryptoAdapter(randomBytes)

    const sessionToken = crypto.generateSessionToken()
    const publicId = crypto.generatePublicId()
    const csrfSeed = crypto.generateCsrfSeed()

    expect(Buffer.from(sessionToken, 'base64url')).toHaveLength(32)
    expect(Buffer.from(publicId, 'base64url')).toHaveLength(16)
    expect(Buffer.from(csrfSeed, 'base64url')).toHaveLength(32)
    expect(new Set([sessionToken, publicId, csrfSeed]).size).toBe(3)
    expect(randomBytes).toHaveBeenNthCalledWith(1, 32)
    expect(randomBytes).toHaveBeenNthCalledWith(2, 16)
    expect(randomBytes).toHaveBeenNthCalledWith(3, 32)
  })

  it('uses the caller-owned HMAC key', () => {
    const crypto = new NodeSessionCryptoAdapter()
    const first = crypto.hmac(Buffer.alloc(32, 1), 'payload')
    const second = crypto.hmac(Buffer.alloc(32, 2), 'payload')

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(second).not.toBe(first)
  })
})
