import { AuthDependencyUnavailableError, AuthError } from './auth-errors'
import type { AuthPersistencePort } from './auth-persistence.port'
import type {
  AuthDurableMutationResult,
  AuthSessionCleanupObserver,
} from './auth.types'
import type { SessionStorePort } from './session-store.port'
import type { TransactionPort } from '@/shared/application/transaction.port'

/** Durably invalidates every generation before best-effort Redis cleanup. */
export class LogoutAllUseCase {
  public constructor(
    private readonly persistence: AuthPersistencePort,
    private readonly transaction: TransactionPort,
    private readonly sessions: SessionStorePort,
    private readonly cleanupObserver?: AuthSessionCleanupObserver,
  ) {}

  public async execute(userId: string): Promise<AuthDurableMutationResult> {
    try {
      await this.transaction.run(() =>
        this.persistence.incrementSessionGeneration(userId),
      )
      try {
        await this.sessions.revokeAll(userId)
        return { cleanupComplete: true }
      } catch {
        this.cleanupObserver?.cleanupIncomplete('logout-all', userId)
        return { cleanupComplete: false }
      }
    } catch (error: unknown) {
      if (error instanceof AuthError) throw error
      throw new AuthDependencyUnavailableError()
    }
  }
}
