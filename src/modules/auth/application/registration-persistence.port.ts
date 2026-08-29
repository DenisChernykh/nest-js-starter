import type {
  SelfServiceRegistrationInput,
  SelfServiceRegistrationResult,
} from './auth.types'

export interface RegistrationPersistencePort {
  registerSelfServiceUser(
    input: SelfServiceRegistrationInput,
  ): Promise<SelfServiceRegistrationResult>
}

export const REGISTRATION_PERSISTENCE: unique symbol = Symbol(
  'REGISTRATION_PERSISTENCE',
)
