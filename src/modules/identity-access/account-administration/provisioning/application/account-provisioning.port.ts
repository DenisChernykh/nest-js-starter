export interface InitialAdminInput {
  readonly email: string
  readonly normalizedEmail: string
  readonly passwordHash: string
  readonly emailVerifiedAt: Date
}

export type InitialAdminResult =
  | { readonly created: true; readonly userId: string }
  | { readonly created: false }

export interface UserProvisioningInput {
  readonly email: string
  readonly normalizedEmail: string
  readonly passwordHash: string
  readonly emailVerifiedAt: Date
  readonly roleKeys: readonly string[]
}

export type CreateUserResult =
  | { readonly created: true; readonly userId: string }
  | { readonly created: false }

export interface AccountProvisioningPort {
  bootstrapInitialAdmin(input: InitialAdminInput): Promise<InitialAdminResult>
  createUser(input: UserProvisioningInput): Promise<CreateUserResult>
}

export const ACCOUNT_PROVISIONING: unique symbol = Symbol(
  'ACCOUNT_PROVISIONING',
)

export class AccountProvisioningIntegrityError extends Error {
  public constructor() {
    super('Auth security state is missing')
    this.name = 'AccountProvisioningIntegrityError'
  }
}
