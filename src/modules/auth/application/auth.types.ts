import type { UserStatus } from '../domain/user-status'
import type { PermissionKey } from './permission'

/** Credential and account snapshot used by the login decision. */
export interface CredentialSnapshot {
  readonly userId: string
  readonly email: string
  readonly normalizedEmail: string
  readonly status: UserStatus
  readonly sessionGeneration: bigint
  readonly passwordHash: string
  readonly passwordVersion: number
  readonly roleKeys: readonly string[]
}

/** Fresh durable account projection used for every authenticated request. */
export interface AuthProjection {
  readonly userId: string
  readonly email: string
  readonly normalizedEmail: string
  readonly status: UserStatus
  readonly sessionGeneration: bigint
  readonly roleKeys: readonly string[]
}

/** Secret-bearing input accepted only by the one-shot admin bootstrap path. */
export interface InitialAdminInput {
  readonly email: string
  readonly normalizedEmail: string
  readonly passwordHash: string
}

/** Result that reveals no credential material from initial admin creation. */
export type InitialAdminResult =
  | { readonly created: true; readonly userId: string }
  | { readonly created: false }

/** Secret-bearing durable input accepted only by user provisioning. */
export interface UserProvisioningInput {
  readonly email: string
  readonly normalizedEmail: string
  readonly passwordHash: string
  readonly roleKeys: readonly string[]
}

/** Result that reveals no credential material from user provisioning. */
export type CreateUserResult =
  | { readonly created: true; readonly userId: string }
  | { readonly created: false }

/** Fresh authenticated identity attached to one request execution chain. */
export interface AuthenticatedPrincipal {
  readonly userId: string
  readonly sessionId: string
  readonly normalizedEmail: string
  readonly roleKeys: readonly string[]
  readonly permissions: ReadonlySet<PermissionKey>
}

/** Result of a durable auth mutation followed by best-effort Redis cleanup. */
export interface AuthDurableMutationResult {
  readonly cleanupComplete: boolean
}

/** Typed best-effort signal for committed invalidation with incomplete cleanup. */
export interface AuthSessionCleanupObserver {
  /** Records a non-durable cleanup failure without changing committed success. */
  cleanupIncomplete(
    operation: 'change-password' | 'logout-all',
    userId: string,
  ): void
}

/** Injection token for best-effort auth cleanup failure observation. */
export const AUTH_SESSION_CLEANUP_OBSERVER: unique symbol = Symbol(
  'AUTH_SESSION_CLEANUP_OBSERVER',
)

/** No-op cleanup observer used when no operational sink is configured. */
export const NOOP_AUTH_SESSION_CLEANUP_OBSERVER: AuthSessionCleanupObserver =
  Object.freeze({
    cleanupIncomplete: () => undefined,
  })

/** Injection token for the constant-time fallback login hash. */
export const AUTH_DUMMY_PASSWORD_HASH: unique symbol = Symbol(
  'AUTH_DUMMY_PASSWORD_HASH',
)
