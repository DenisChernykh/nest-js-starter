import type {
  AuthProjection,
  CredentialSnapshot,
  InitialAdminInput,
  InitialAdminResult,
} from './auth.types'

/** Durable identity and security-state operations required by auth use cases. */
export interface AuthPersistencePort {
  /** Loads credentials by canonical email without changing the supplied key. */
  findCredentialByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<CredentialSnapshot | undefined>
  /** Loads a fresh request projection or returns absence. */
  findAuthProjectionByUserId(
    userId: string,
  ): Promise<AuthProjection | undefined>
  /** Reads the singleton global session epoch. */
  readGlobalSessionEpoch(): Promise<bigint>
  /** Replaces a hash only when the expected credential version still matches. */
  replacePasswordIfVersion(
    userId: string,
    expectedVersion: number,
    passwordHash: string,
  ): Promise<boolean>
  /** Atomically increments and returns one user's session generation. */
  incrementSessionGeneration(userId: string): Promise<bigint>
  /** Creates at most one initial administrator across concurrent processes. */
  bootstrapInitialAdmin(input: InitialAdminInput): Promise<InitialAdminResult>
}

/** Injection token for durable auth identity and security-state operations. */
export const AUTH_PERSISTENCE: unique symbol = Symbol('AUTH_PERSISTENCE')

/** Integrity failure for the required singleton auth security state. */
export class AuthPersistenceIntegrityError extends Error {
  public constructor() {
    super('Auth security state is missing')
    this.name = 'AuthPersistenceIntegrityError'
  }
}
