import type {
  ConfirmPasswordResetInput,
  PasswordResetTokenSource,
  SelfServiceDeliveryTarget,
  SelfServiceTokenInput,
} from './auth.types'
import type { AccountActorAuthorization } from './account-administration.port'

export interface PasswordRecoveryPersistencePort {
  rotatePasswordResetToken(
    normalizedEmail: string,
    token: SelfServiceTokenInput,
    now: Date,
  ): Promise<SelfServiceDeliveryTarget | undefined>
  getEligiblePasswordResetTokenSource(
    tokenDigest: string,
    now: Date,
  ): Promise<PasswordResetTokenSource | undefined>
  confirmPasswordReset(
    input: ConfirmPasswordResetInput,
  ): Promise<SelfServiceDeliveryTarget | undefined>
  rotateAdministratorPasswordReset(input: {
    readonly actorId: string
    readonly accountId: string
    readonly actorAuthorization: AccountActorAuthorization
    readonly token: SelfServiceTokenInput
    readonly now: Date
  }): Promise<SelfServiceDeliveryTarget | undefined>
}

export const PASSWORD_RECOVERY_PERSISTENCE: unique symbol = Symbol(
  'PASSWORD_RECOVERY_PERSISTENCE',
)
