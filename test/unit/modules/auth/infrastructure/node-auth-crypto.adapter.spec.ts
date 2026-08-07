import { NodeAuthCryptoAdapter } from '@/modules/auth/infrastructure/node-auth-crypto.adapter'
import { createHash } from 'node:crypto'

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

  it('issues canonical one-time tokens and digests their decoded bytes', () => {
    const randomBytes = jest.fn((size: number) => Buffer.alloc(size, 7))
    const crypto = new NodeAuthCryptoAdapter(randomBytes)

    const issued = crypto.issue()

    expect(issued.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(issued.digest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(Buffer.from(issued.rawToken, 'base64url')).toHaveLength(32)
    expect(issued.digest).toBe(
      createHash('sha256')
        .update(Buffer.from(issued.rawToken, 'base64url'))
        .digest('base64url'),
    )
    expect(randomBytes).toHaveBeenCalledWith(32)
  })

  it('returns undefined for malformed or non-32-byte token input', () => {
    const crypto = new NodeAuthCryptoAdapter()

    expect(crypto.digest('not a token')).toBeUndefined()
    expect(
      crypto.digest(Buffer.alloc(31, 1).toString('base64url')),
    ).toBeUndefined()
    expect(
      crypto.digest(Buffer.alloc(33, 1).toString('base64url')),
    ).toBeUndefined()
  })

  it('produces deterministic one-time token output from injected bytes', () => {
    const crypto = new NodeAuthCryptoAdapter(() => Buffer.alloc(32, 9))

    expect(crypto.issue()).toEqual({
      rawToken: Buffer.alloc(32, 9).toString('base64url'),
      digest: createHash('sha256')
        .update(Buffer.alloc(32, 9))
        .digest('base64url'),
    })
  })
})
