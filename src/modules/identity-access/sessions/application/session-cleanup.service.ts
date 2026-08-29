import { Inject, Injectable } from '@nestjs/common'

import { SESSION_STORE, type SessionStorePort } from './session-store.port'

export interface AuthDurableMutationResult {
  readonly cleanupComplete: boolean
}

export type SessionCleanupOperation =
  | 'change-password'
  | 'logout-all'
  | 'password-reset'
  | 'account-disable'
  | 'account-retire'
  | 'admin-logout-all'

export interface AuthSessionCleanupObserver {
  cleanupIncomplete(operation: SessionCleanupOperation, userId: string): void
}

export const AUTH_SESSION_CLEANUP_OBSERVER: unique symbol = Symbol(
  'AUTH_SESSION_CLEANUP_OBSERVER',
)

export const NOOP_AUTH_SESSION_CLEANUP_OBSERVER: AuthSessionCleanupObserver =
  Object.freeze({
    cleanupIncomplete: () => undefined,
  })

@Injectable()
export class SessionCleanupService {
  public constructor(
    @Inject(SESSION_STORE)
    private readonly sessions: SessionStorePort,
    @Inject(AUTH_SESSION_CLEANUP_OBSERVER)
    private readonly observer: AuthSessionCleanupObserver = NOOP_AUTH_SESSION_CLEANUP_OBSERVER,
  ) {}

  public async cleanupAfterDurableInvalidation(
    operation: SessionCleanupOperation,
    userId: string,
  ): Promise<boolean> {
    try {
      await this.sessions.revokeAll(userId)
      return true
    } catch {
      this.observer.cleanupIncomplete(operation, userId)
      return false
    }
  }
}
