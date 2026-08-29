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

export type { AccountActorAuthorization } from './actor-authorization-requirement'
