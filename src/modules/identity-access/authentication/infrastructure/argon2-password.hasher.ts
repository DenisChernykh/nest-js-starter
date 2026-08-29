import {
  argon2id,
  hash as argon2Hash,
  needsRehash,
  verify as argon2Verify,
} from 'argon2'

import { PasswordHashingError } from '../../public-contracts/auth-errors'
import type {
  PasswordHasherPort,
  PasswordVerification,
} from '../application/password-hasher.port'

const passwordHashOptions = Object.freeze({
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
})

/** Implements the fixed Argon2id password policy with redacted failures. */
export class Argon2PasswordHasher implements PasswordHasherPort {
  public async hash(password: string): Promise<string> {
    try {
      const encoded: unknown = await argon2Hash(password, passwordHashOptions)
      if (typeof encoded !== 'string') throw new PasswordHashingError()
      return encoded
    } catch {
      throw new PasswordHashingError()
    }
  }

  public async verify(
    password: string,
    encodedHash: string,
  ): Promise<PasswordVerification> {
    try {
      const matches = await argon2Verify(encodedHash, password)
      return {
        matches,
        needsRehash: matches && needsRehash(encodedHash, passwordHashOptions),
      }
    } catch {
      throw new PasswordHashingError()
    }
  }
}
