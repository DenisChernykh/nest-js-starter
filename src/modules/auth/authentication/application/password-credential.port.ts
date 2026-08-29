export type CredentialStatus = 'active' | 'disabled'

export interface CredentialSnapshot {
  readonly userId: string
  readonly status: CredentialStatus
  readonly emailVerifiedAt: Date | undefined
  readonly passwordHash: string
  readonly passwordVersion: number
}

export interface ChangePasswordAndInvalidateInput {
  readonly userId: string
  readonly expectedVersion: number
  readonly passwordHash: string
}

export interface PasswordCredentialPort {
  findCredentialByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<CredentialSnapshot | undefined>
  findCredentialByUserId(
    userId: string,
  ): Promise<CredentialSnapshot | undefined>
  replacePasswordIfVersion(
    userId: string,
    expectedVersion: number,
    passwordHash: string,
  ): Promise<boolean>
  changePasswordAndInvalidate(
    input: ChangePasswordAndInvalidateInput,
  ): Promise<boolean>
}

export const PASSWORD_CREDENTIALS: unique symbol = Symbol(
  'PASSWORD_CREDENTIALS',
)
