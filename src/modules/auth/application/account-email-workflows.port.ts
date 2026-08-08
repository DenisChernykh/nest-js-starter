import type {
  SelfServiceDeliveryTarget,
  SelfServiceTokenInput,
} from './auth.types'
import type { AccountActorAuthorization } from './account-administration.port'

export interface AccountEmailWorkflowsPort {
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
  rotateAdministratorPasswordReset(input: {
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

export const ACCOUNT_EMAIL_WORKFLOWS = Symbol('ACCOUNT_EMAIL_WORKFLOWS')
