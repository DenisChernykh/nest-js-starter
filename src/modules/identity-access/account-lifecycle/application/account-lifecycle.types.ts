export interface AccountLifecycleTokenInput {
  readonly tokenDigest: string
  readonly expiresAt: Date
  readonly createdAt: Date
}

export interface AccountLifecycleDeliveryTarget {
  readonly userId: string
  readonly email: string
}

export type PasswordResetTokenSource = 'self-service' | 'administrator'

export interface ConfirmPasswordResetPersistenceInput {
  readonly tokenDigest: string
  readonly source: PasswordResetTokenSource
  readonly now: Date
  readonly passwordHash: string
}
