import type {
  AccountAdministrationState,
  AdminAccount,
} from '../application/account-administration.model'
import type { Prisma } from '@/generated/prisma/client'

export const adminAccountInclude = {
  roles: { select: { roleKey: true } },
} as const

export type AdminAccountRow = Prisma.UserGetPayload<{
  include: typeof adminAccountInclude
}>

export function mapAdminAccount(row: AdminAccountRow): AdminAccount {
  return {
    id: row.id,
    email: row.status === 'RETIRED' ? null : row.email,
    state: row.status.toLowerCase() as AccountAdministrationState,
    emailVerifiedAt: row.emailVerifiedAt,
    roleKeys: row.roles.map(({ roleKey }) => roleKey).sort(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    retiredAt: row.retiredAt,
    revision: row.accountRevision,
  }
}

export function accountStateToPrisma(
  state: AccountAdministrationState,
): 'INVITED' | 'ACTIVE' | 'DISABLED' | 'RETIRED' {
  return state.toUpperCase() as 'INVITED' | 'ACTIVE' | 'DISABLED' | 'RETIRED'
}
