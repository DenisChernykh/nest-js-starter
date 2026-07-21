import type { AuthPersistencePort } from './auth-persistence.port'
import type { InitialAdminResult } from './auth.types'
import type { PasswordHasherPort } from './password-hasher.port'
import { NOOP_AUTH_AUDIT, type AuthAuditPort } from './auth-audit.port'

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
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  /** Returns false after any process has already completed bootstrap. */
  public async execute(
    input: CreateInitialAdminInput,
  ): Promise<InitialAdminResult> {
    try {
      const normalizedEmail = input.email.trim().toLowerCase()
      const passwordHash = await this.passwords.hash(input.password)
      const result = await this.persistence.bootstrapInitialAdmin({
        email: input.email.trim(),
        normalizedEmail,
        passwordHash,
      })
      this.audit.emit({
        action: 'initial_admin_create',
        outcome: result.created ? 'success' : 'conflict',
        reasonCode: result.created ? 'INITIAL_ADMIN_CREATED' : 'ALREADY_EXISTS',
        ...(result.created
          ? { targetType: 'user' as const, targetId: result.userId }
          : {}),
      })
      return result
    } catch (error: unknown) {
      this.audit.emit({
        action: 'initial_admin_create',
        outcome: 'denied',
        reasonCode: 'DEPENDENCY_UNAVAILABLE',
      })
      throw error
    }
  }
}
