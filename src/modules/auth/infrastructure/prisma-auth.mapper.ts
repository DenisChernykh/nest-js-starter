import type { CredentialSnapshot } from '../authentication/application/password-credential.port'
import type { AuthProjection } from '../identity/application/identity-security-state.port'
import type { UserStatus } from '../identity/domain/user-status'

/** Structural Prisma row needed by the auth projection mapper. */
export interface AuthProjectionRow {
  readonly id: string
  readonly email: string
  readonly normalizedEmail: string
  readonly status: 'INVITED' | 'ACTIVE' | 'DISABLED' | 'RETIRED'
  readonly emailVerifiedAt: Date | null
  readonly sessionGeneration: bigint
  readonly roles: readonly { readonly roleKey: string }[]
}

/** Structural Prisma row needed by the credential mapper. */
export interface CredentialSnapshotRow {
  readonly id: string
  readonly status: AuthProjectionRow['status']
  readonly emailVerifiedAt: Date | null
  readonly credential: {
    readonly passwordHash: string
    readonly version: number
  } | null
}

function mapStatus(status: AuthProjectionRow['status']): UserStatus {
  return status === 'ACTIVE' ? 'active' : 'disabled'
}

function sortedRoleKeys(roles: AuthProjectionRow['roles']): readonly string[] {
  return Object.freeze(roles.map(({ roleKey }) => roleKey).sort())
}

/** Maps a generated-client row to the framework-free request projection. */
export function mapAuthProjection(row: AuthProjectionRow): AuthProjection {
  return Object.freeze({
    userId: row.id,
    email: row.email,
    normalizedEmail: row.normalizedEmail,
    status: mapStatus(row.status),
    sessionGeneration: row.sessionGeneration,
    roleKeys: sortedRoleKeys(row.roles),
  })
}

/** Maps a row with credentials, preserving absence without a partial result. */
export function mapCredentialSnapshot(
  row: CredentialSnapshotRow,
): CredentialSnapshot | undefined {
  if (row.credential === null) return undefined
  return Object.freeze({
    userId: row.id,
    status: mapStatus(row.status),
    emailVerifiedAt: row.emailVerifiedAt ?? undefined,
    passwordHash: row.credential.passwordHash,
    passwordVersion: row.credential.version,
  })
}
