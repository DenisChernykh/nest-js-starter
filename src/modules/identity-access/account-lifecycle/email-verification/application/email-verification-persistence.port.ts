import type {
  AccountLifecycleDeliveryTarget,
  AccountLifecycleTokenInput,
} from '../../application/account-lifecycle.types'

export interface EmailVerificationPersistencePort {
  rotateEmailVerificationToken(
    normalizedEmail: string,
    token: AccountLifecycleTokenInput,
    now: Date,
  ): Promise<AccountLifecycleDeliveryTarget | undefined>
  confirmEmailVerification(
    tokenDigest: string,
    now: Date,
  ): Promise<AccountLifecycleDeliveryTarget | undefined>
}

export const EMAIL_VERIFICATION_PERSISTENCE: unique symbol = Symbol(
  'EMAIL_VERIFICATION_PERSISTENCE',
)
