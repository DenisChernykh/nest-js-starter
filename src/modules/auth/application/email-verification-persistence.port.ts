import type {
  SelfServiceDeliveryTarget,
  SelfServiceTokenInput,
} from './auth.types'

export interface EmailVerificationPersistencePort {
  rotateEmailVerificationToken(
    normalizedEmail: string,
    token: SelfServiceTokenInput,
    now: Date,
  ): Promise<SelfServiceDeliveryTarget | undefined>
  confirmEmailVerification(
    tokenDigest: string,
    now: Date,
  ): Promise<SelfServiceDeliveryTarget | undefined>
}

export const EMAIL_VERIFICATION_PERSISTENCE: unique symbol = Symbol(
  'EMAIL_VERIFICATION_PERSISTENCE',
)
