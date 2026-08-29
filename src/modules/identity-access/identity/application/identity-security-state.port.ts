import type { UserStatus } from '../domain/user-status'

export interface AuthProjection {
  readonly userId: string
  readonly email: string
  readonly normalizedEmail: string
  readonly status: UserStatus
  readonly sessionGeneration: bigint
  readonly roleKeys: readonly string[]
}

export interface IdentitySecurityStatePort {
  findAuthProjectionByUserId(
    userId: string,
  ): Promise<AuthProjection | undefined>
  readGlobalSessionEpoch(): Promise<bigint>
}

export const IDENTITY_SECURITY_STATE: unique symbol = Symbol(
  'IDENTITY_SECURITY_STATE',
)

export class IdentitySecurityStateIntegrityError extends Error {
  public constructor() {
    super('Auth security state is missing')
    this.name = 'IdentitySecurityStateIntegrityError'
  }
}
