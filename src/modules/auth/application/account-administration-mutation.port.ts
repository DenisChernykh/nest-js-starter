import type {
  AccountAdministrationState,
  AdminAccount,
} from './account-administration.port'
import type { AccountActorAuthorization } from './actor-authorization-requirement'

export interface AccountAdministrationMutationPort {
  changeStatus(input: {
    readonly actorId: string
    readonly accountId: string
    readonly status: Extract<AccountAdministrationState, 'active' | 'disabled'>
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

export const ACCOUNT_ADMINISTRATION_MUTATION: unique symbol = Symbol(
  'ACCOUNT_ADMINISTRATION_MUTATION',
)
