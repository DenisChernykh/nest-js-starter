import type { AuthPersistencePort } from './auth-persistence.port'
import type { InitialAdminResult } from './auth.types'
import type { PasswordHasherPort } from './password-hasher.port'

/** One-shot administrator credentials supplied only by the local CLI. */
export interface CreateInitialAdminInput {
  readonly email: string
  readonly password: string
}

/** Hashes credentials and delegates the cross-process one-shot commit. */
export class CreateInitialAdminUseCase {
  public constructor(
    private readonly persistence: AuthPersistencePort,
    private readonly passwords: PasswordHasherPort,
  ) {}

  /** Returns false after any process has already completed bootstrap. */
  public async execute(
    input: CreateInitialAdminInput,
  ): Promise<InitialAdminResult> {
    const normalizedEmail = input.email.trim().toLowerCase()
    const passwordHash = await this.passwords.hash(input.password)
    return this.persistence.bootstrapInitialAdmin({
      email: input.email.trim(),
      normalizedEmail,
      passwordHash,
    })
  }
}
