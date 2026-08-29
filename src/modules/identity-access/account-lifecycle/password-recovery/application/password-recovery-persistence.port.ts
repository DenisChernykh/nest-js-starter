import type {
  AccountLifecycleDeliveryTarget,
  AccountLifecycleTokenInput,
  ConfirmPasswordResetPersistenceInput,
  PasswordResetTokenSource,
} from '../../application/account-lifecycle.types'
import type { AccountActorAuthorization } from '../../../authorization/application/account-actor-authorization'

export interface PasswordRecoveryPersistencePort {
  rotatePasswordResetToken(
    normalizedEmail: string,
    token: AccountLifecycleTokenInput,
    now: Date,
  ): Promise<AccountLifecycleDeliveryTarget | undefined>
  getEligiblePasswordResetTokenSource(
    tokenDigest: string,
    now: Date,
  ): Promise<PasswordResetTokenSource | undefined>
  confirmPasswordReset(
    input: ConfirmPasswordResetPersistenceInput,
  ): Promise<AccountLifecycleDeliveryTarget | undefined>
  rotateAdministratorPasswordReset(input: {
    readonly actorId: string
    readonly accountId: string
    readonly actorAuthorization: AccountActorAuthorization
    readonly token: AccountLifecycleTokenInput
    readonly now: Date
  }): Promise<AccountLifecycleDeliveryTarget | undefined>
}

export const PASSWORD_RECOVERY_PERSISTENCE: unique symbol = Symbol(
  'PASSWORD_RECOVERY_PERSISTENCE',
)
