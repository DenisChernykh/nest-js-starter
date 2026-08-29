import { CreateUserUseCase } from '../application/create-user.use-case'
import { PrismaAccountProvisioningAdapter } from '../account-administration/provisioning/infrastructure/prisma-account-provisioning.adapter'
import {
  createAuthRoleRegistry,
  type RoleDefinition,
} from '../application/role-registry'
import { Argon2PasswordHasher } from '../infrastructure/argon2-password.hasher'
import type { AuthAuditPort } from '../application/auth-audit.port'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import type { TransactionPort } from '@/shared/application/transaction.port'

export { UnknownRoleAssignmentError } from '../application/auth-errors'
export type {
  CreateUserInput,
  CreateUserResult,
} from '../application/create-user.use-case'

/** Composes PostgreSQL-only user provisioning from auth-owned adapters. */
export function createUserCommand(
  provider: PrismaClientProvider,
  transaction: TransactionPort,
  audit: AuthAuditPort,
  roleDefinitions: readonly RoleDefinition[],
): CreateUserUseCase {
  return new CreateUserUseCase(
    new PrismaAccountProvisioningAdapter(provider, transaction),
    new Argon2PasswordHasher(),
    createAuthRoleRegistry(roleDefinitions),
    audit,
  )
}
