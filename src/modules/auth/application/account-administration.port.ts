export type AccountAdministrationState =
  'invited' | 'active' | 'disabled' | 'retired'

export interface AdminAccount {
  readonly id: string
  readonly email: string | null
  readonly state: AccountAdministrationState
  readonly emailVerifiedAt: Date | null
  readonly roleKeys: readonly string[]
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly retiredAt: Date | null
  readonly revision: number
}

export interface AccountActorAuthorization {
  readonly requiredRoleGroups: readonly (readonly string[])[]
}

export interface AccountAdministrationPort {
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
  changeStatus(input: {
    readonly actorId: string
    readonly accountId: string
    readonly status: 'active' | 'disabled'
    readonly expectedRevision: number
    readonly actorAuthorization: AccountActorAuthorization
  }): Promise<AdminAccount | undefined>
  replaceRoles(input: {
    readonly actorId: string
    readonly accountId: string
    readonly roleKeys: readonly string[]
    readonly expectedRevision: number
    readonly actorAuthorization: AccountActorAuthorization
  }): Promise<AdminAccount | undefined>
  retireAccount(input: {
    readonly actorId: string
    readonly accountId: string
    readonly expectedRevision: number
    readonly actorAuthorization: AccountActorAuthorization
  }): Promise<boolean>
  revokeAllSessions(input: {
    readonly actorId: string
    readonly accountId: string
    readonly actorAuthorization: AccountActorAuthorization
  }): Promise<boolean>
}

export const ACCOUNT_ADMINISTRATION = Symbol('ACCOUNT_ADMINISTRATION')
