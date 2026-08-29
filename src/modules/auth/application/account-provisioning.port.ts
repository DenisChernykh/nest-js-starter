import type {
  CreateUserResult,
  InitialAdminInput,
  InitialAdminResult,
  UserProvisioningInput,
} from './auth.types'

export interface AccountProvisioningPort {
  bootstrapInitialAdmin(input: InitialAdminInput): Promise<InitialAdminResult>
  createUser(input: UserProvisioningInput): Promise<CreateUserResult>
}

export const ACCOUNT_PROVISIONING: unique symbol = Symbol(
  'ACCOUNT_PROVISIONING',
)
