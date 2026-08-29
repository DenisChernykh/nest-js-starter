import type { AccountLifecycleTokenInput } from '../../application/account-lifecycle.types'

export interface SelfServiceRegistrationInput extends AccountLifecycleTokenInput {
  readonly email: string
  readonly normalizedEmail: string
  readonly passwordHash: string
}

export type SelfServiceRegistrationResult =
  | { readonly created: true; readonly userId: string; readonly email: string }
  | { readonly created: false }

export interface RegistrationPersistencePort {
  registerSelfServiceUser(
    input: SelfServiceRegistrationInput,
  ): Promise<SelfServiceRegistrationResult>
}

export const REGISTRATION_PERSISTENCE: unique symbol = Symbol(
  'REGISTRATION_PERSISTENCE',
)
