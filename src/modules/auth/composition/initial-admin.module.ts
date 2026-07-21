import { CreateInitialAdminUseCase } from '../application/create-initial-admin.use-case'
import { Argon2PasswordHasher } from '../infrastructure/argon2-password.hasher'
import { PrismaAuthRepository } from '../infrastructure/prisma-auth.repository'
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
    new PrismaAuthRepository(provider, transaction),
    new Argon2PasswordHasher(),
    audit,
  )
}
