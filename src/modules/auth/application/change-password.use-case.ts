import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthenticationFailedError,
  AuthStateConflictError,
} from './auth-errors'
import type { AuthPersistencePort } from './auth-persistence.port'
import type {
  AuthDurableMutationResult,
  AuthSessionCleanupObserver,
} from './auth.types'
import type { PasswordHasherPort } from './password-hasher.port'
import type { SessionStorePort } from './session-store.port'
import type { TransactionPort } from '@/shared/application/transaction.port'

/** Current/new password mutation fields bound to one authenticated identity. */
export interface ChangePasswordInput {
  readonly userId: string
  readonly normalizedEmail: string
  readonly currentPassword: string
  readonly newPassword: string
}

/** Changes credentials durably before best-effort invalidation of Redis state. */
export class ChangePasswordUseCase {
  public constructor(
    private readonly persistence: AuthPersistencePort,
    private readonly passwords: PasswordHasherPort,
    private readonly transaction: TransactionPort,
    private readonly sessions: SessionStorePort,
    private readonly cleanupObserver?: AuthSessionCleanupObserver,
  ) {}

  public async execute(
    input: ChangePasswordInput,
  ): Promise<AuthDurableMutationResult> {
    try {
      const snapshot = await this.persistence.findCredentialByNormalizedEmail(
        input.normalizedEmail,
      )
      if (snapshot === undefined || snapshot.userId !== input.userId)
        throw new AuthenticationFailedError()
      const current = await this.passwords.verify(
        input.currentPassword,
        snapshot.passwordHash,
      )
      if (!current.matches) throw new AuthenticationFailedError()
      const nextHash = await this.passwords.hash(input.newPassword)
      await this.transaction.run(async () => {
        const replaced = await this.persistence.replacePasswordIfVersion(
          input.userId,
          snapshot.passwordVersion,
          nextHash,
        )
        if (!replaced) throw new AuthStateConflictError()
        await this.persistence.incrementSessionGeneration(input.userId)
      })
      try {
        await this.sessions.revokeAll(input.userId)
        return { cleanupComplete: true }
      } catch {
        this.cleanupObserver?.cleanupIncomplete('change-password', input.userId)
        return { cleanupComplete: false }
      }
    } catch (error: unknown) {
      if (error instanceof AuthError) throw error
      throw new AuthDependencyUnavailableError()
    }
  }
}
