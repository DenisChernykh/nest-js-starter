import { CreateInitialAdminUseCase } from '../application/create-initial-admin.use-case'
import { PrismaAccountProvisioningAdapter } from '../account-administration/provisioning/infrastructure/prisma-account-provisioning.adapter'
import { Argon2PasswordHasher } from '../infrastructure/argon2-password.hasher'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import type { TransactionPort } from '@/shared/application/transaction.port'
import type { AuthAuditPort } from '../application/auth-audit.port'

/** Composes the auth-owned one-shot command without HTTP or Redis providers. */
export function createInitialAdminCommand(
  provider: PrismaClientProvider,
  transaction: TransactionPort,
  audit: AuthAuditPort,
): CreateInitialAdminUseCase {
  return new CreateInitialAdminUseCase(
    new PrismaAccountProvisioningAdapter(provider, transaction),
    new Argon2PasswordHasher(),
    audit,
  )
}
