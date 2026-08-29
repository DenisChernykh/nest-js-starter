import { CreateUserUseCase } from '../account-administration/provisioning/application/create-user.use-case'
import { PrismaAccountProvisioningAdapter } from '../account-administration/provisioning/infrastructure/prisma-account-provisioning.adapter'
import { Argon2PasswordHasher } from '../authentication/infrastructure/argon2-password.hasher'
import {
  createAuthRoleRegistry,
  type RoleDefinition,
} from '../authorization/application/role-registry'
import type { AuthAuditPort } from '../public-contracts/auth-audit.port'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import type { TransactionPort } from '@/shared/application/transaction.port'

export { UnknownRoleAssignmentError } from '../public-contracts/auth-errors'
export type {
  CreateUserInput,
  CreateUserResult,
} from '../account-administration/provisioning/application/create-user.use-case'

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
