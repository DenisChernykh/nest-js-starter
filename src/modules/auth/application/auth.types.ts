/** Secret-bearing input accepted only by the one-shot admin bootstrap path. */
export interface InitialAdminInput {
  readonly email: string
  readonly normalizedEmail: string
  readonly passwordHash: string
  readonly emailVerifiedAt: Date
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
  readonly emailVerifiedAt: Date
  readonly roleKeys: readonly string[]
}

/** Result that reveals no credential material from user provisioning. */
export type CreateUserResult =
  | { readonly created: true; readonly userId: string }
  | { readonly created: false }

export interface SelfServiceTokenInput {
  readonly tokenDigest: string
  readonly expiresAt: Date
  readonly createdAt: Date
}

export interface SelfServiceRegistrationInput extends SelfServiceTokenInput {
  readonly email: string
  readonly normalizedEmail: string
  readonly passwordHash: string
}

export type SelfServiceRegistrationResult =
  | { readonly created: true; readonly userId: string; readonly email: string }
  | { readonly created: false }

export interface SelfServiceDeliveryTarget {
  readonly userId: string
  readonly email: string
}

export type PasswordResetTokenSource = 'self-service' | 'administrator'

export interface ConfirmPasswordResetInput {
  readonly tokenDigest: string
  readonly source: PasswordResetTokenSource
  readonly now: Date
  readonly passwordHash: string
}
