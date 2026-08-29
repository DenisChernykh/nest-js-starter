import type { AccountActorAuthorization } from './account-administration.port'
import type {
  SelfServiceDeliveryTarget,
  SelfServiceTokenInput,
} from './auth.types'

export interface InvitationPersistencePort {
  createInvitation(
    input: {
      readonly email: string
      readonly normalizedEmail: string
      readonly roleKeys: readonly string[]
      readonly actorId: string
      readonly actorAuthorization: AccountActorAuthorization
    } & SelfServiceTokenInput,
  ): Promise<SelfServiceDeliveryTarget | undefined>
  resendInvitation(input: {
    readonly actorId: string
    readonly accountId: string
    readonly actorAuthorization: AccountActorAuthorization
    readonly token: SelfServiceTokenInput
    readonly now: Date
  }): Promise<SelfServiceDeliveryTarget | undefined>
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
