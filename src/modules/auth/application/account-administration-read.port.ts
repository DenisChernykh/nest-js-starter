import type {
  AccountAdministrationState,
  AdminAccount,
} from './account-administration.port'

export interface AccountAdministrationReadPort {
  listAccounts(input: {
    readonly page: number
    readonly pageSize: number
    readonly search?: string
    readonly state?: AccountAdministrationState
  }): Promise<{
    readonly items: readonly AdminAccount[]
    readonly total: number
  }>
  getAccount(accountId: string): Promise<AdminAccount | undefined>
}

export const ACCOUNT_ADMINISTRATION_READ: unique symbol = Symbol(
  'ACCOUNT_ADMINISTRATION_READ',
)
