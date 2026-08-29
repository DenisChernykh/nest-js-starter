import type { CredentialSnapshot } from './auth.types'

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
