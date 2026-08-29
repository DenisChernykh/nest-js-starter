import type { AuthProjection } from './auth.types'

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
