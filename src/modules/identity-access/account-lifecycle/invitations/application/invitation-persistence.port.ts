import type { AccountActorAuthorization } from '../../../authorization/application/account-actor-authorization'
import type {
  AccountLifecycleDeliveryTarget,
  AccountLifecycleTokenInput,
} from '../../application/account-lifecycle.types'

export interface InvitationPersistencePort {
  createInvitation(
    input: {
      readonly email: string
      readonly normalizedEmail: string
      readonly roleKeys: readonly string[]
      readonly actorId: string
      readonly actorAuthorization: AccountActorAuthorization
    } & AccountLifecycleTokenInput,
  ): Promise<AccountLifecycleDeliveryTarget | undefined>
  resendInvitation(input: {
    readonly actorId: string
    readonly accountId: string
    readonly actorAuthorization: AccountActorAuthorization
    readonly token: AccountLifecycleTokenInput
    readonly now: Date
  }): Promise<AccountLifecycleDeliveryTarget | undefined>
  isInvitationTokenEligible(tokenDigest: string, now: Date): Promise<boolean>
  acceptInvitation(input: {
    readonly tokenDigest: string
    readonly passwordHash: string
    readonly now: Date
  }): Promise<boolean>
}

export const INVITATION_PERSISTENCE: unique symbol = Symbol(
  'INVITATION_PERSISTENCE',
)
