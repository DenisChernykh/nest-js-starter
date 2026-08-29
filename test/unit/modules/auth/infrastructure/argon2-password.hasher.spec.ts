import { hash, argon2id } from 'argon2'

import { PasswordHashingError } from '@/modules/auth/application/auth-errors'
import { Argon2PasswordHasher } from '@/modules/auth/authentication/infrastructure/argon2-password.hasher'

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher()
  const password = 'correct horse battery staple'

  it('hashes with the exact Argon2id policy and verifies a match', async () => {
    const encoded = await hasher.hash(password)

    expect(encoded).toContain('$argon2id$v=19$m=19456,p=1,t=2$')
    await expect(hasher.verify(password, encoded)).resolves.toEqual({
      matches: true,
      needsRehash: false,
    })
  })

  it('returns the same safe mismatch shape for a wrong password', async () => {
    const encoded = await hasher.hash(password)

    await expect(hasher.verify('wrong password', encoded)).resolves.toEqual({
      matches: false,
      needsRehash: false,
    })
  })

  it('marks a valid weaker Argon2id hash for rehash', async () => {
    const weakerResult: unknown = await hash(password, {
      type: argon2id,
      memoryCost: 8_192,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    })
    if (typeof weakerResult !== 'string') throw new Error('Expected PHC string')

    await expect(hasher.verify(password, weakerResult)).resolves.toEqual({
      matches: true,
      needsRehash: true,
    })
  })

  it('maps malformed or internal library failures without secret text', async () => {
    const malformed = '$argon2id$not-a-valid-phc'

    const failure = await hasher
      .verify(password, malformed)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PasswordHashingError)
    expect(String(failure)).not.toContain(password)
    expect(String(failure)).not.toContain(malformed)
  })
})
