import { NodeAuthCryptoAdapter } from '@/modules/auth/infrastructure/node-auth-crypto.adapter'

describe('NodeAuthCryptoAdapter', () => {
  it('generates opaque values from independent random byte calls', () => {
    let byte = 0
    const randomBytes = jest.fn((size: number) => Buffer.alloc(size, ++byte))
    const crypto = new NodeAuthCryptoAdapter(randomBytes)

    const sessionToken = crypto.generateSessionToken()
    const publicId = crypto.generatePublicId()
    const csrfSeed = crypto.generateCsrfSeed()

    expect(Buffer.from(sessionToken, 'base64url')).toHaveLength(32)
    expect(Buffer.from(publicId, 'base64url')).toHaveLength(16)
    expect(Buffer.from(csrfSeed, 'base64url')).toHaveLength(32)
    expect(new Set([sessionToken, publicId, csrfSeed]).size).toBe(3)
    expect(randomBytes).toHaveBeenCalledTimes(3)
  })

  it('uses HMAC keys explicitly and compares canonical bytes safely', () => {
    const crypto = new NodeAuthCryptoAdapter()
    const firstKey = new Uint8Array(Buffer.alloc(32, 1))
    const secondKey = new Uint8Array(Buffer.alloc(32, 2))
    const first = crypto.hmac(firstKey, 'payload')
    const second = crypto.hmac(secondKey, 'payload')

    expect(first).not.toBe(second)
    expect(crypto.constantTimeEqualBase64Url(first, first)).toBe(true)
    expect(crypto.constantTimeEqualBase64Url(first, second)).toBe(false)
    expect(crypto.constantTimeEqualBase64Url(first, 'not+base64url')).toBe(
      false,
    )
    expect(crypto.constantTimeEqualBase64Url(first, 'AA')).toBe(false)
  })
})
