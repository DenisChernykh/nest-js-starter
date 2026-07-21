import type { UserStatus } from '../domain/user-status'

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
