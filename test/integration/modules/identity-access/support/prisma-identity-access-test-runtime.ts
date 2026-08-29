import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'

import { PrismaAccountAdministrationMutationAdapter } from '@/modules/identity-access/account-administration/infrastructure/prisma-account-administration-mutation.adapter'
import { PrismaAccountAdministrationReadAdapter } from '@/modules/identity-access/account-administration/infrastructure/prisma-account-administration-read.adapter'
import { PrismaEmailVerificationAdapter } from '@/modules/identity-access/account-lifecycle/email-verification/infrastructure/prisma-email-verification.adapter'
import { PrismaInvitationAdapter } from '@/modules/identity-access/account-lifecycle/invitations/infrastructure/prisma-invitation.adapter'
import { PrismaPasswordRecoveryAdapter } from '@/modules/identity-access/account-lifecycle/password-recovery/infrastructure/prisma-password-recovery.adapter'
import { PrismaRegistrationAdapter } from '@/modules/identity-access/account-lifecycle/registration/infrastructure/prisma-registration.adapter'
import { PrismaPasswordCredentialAdapter } from '@/modules/identity-access/authentication/infrastructure/prisma-password-credential.adapter'
import { PrismaIdentitySecurityStateAdapter } from '@/modules/identity-access/identity/infrastructure/prisma-identity-security-state.adapter'
import { PrismaSessionGenerationAdapter } from '@/modules/identity-access/sessions/infrastructure/prisma-session-generation.adapter'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionAdapter } from '@/platform/database/prisma-transaction.adapter'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { runPrismaCommand } from '@test/integration/support/run-prisma-command'

export interface PrismaIdentityAccessTestRuntime {
  readonly provider: PrismaClientProvider
  readonly blocker: Pool
  readonly identity: PrismaIdentitySecurityStateAdapter
  readonly credentials: PrismaPasswordCredentialAdapter
  readonly sessions: PrismaSessionGenerationAdapter
  readonly registration: PrismaRegistrationAdapter
  readonly verification: PrismaEmailVerificationAdapter
  readonly recovery: PrismaPasswordRecoveryAdapter
  readonly invitations: PrismaInvitationAdapter
  readonly administrationRead: PrismaAccountAdministrationReadAdapter
  readonly administrationMutation: PrismaAccountAdministrationMutationAdapter
  reset(): Promise<void>
  close(): Promise<void>
}

export async function startPrismaIdentityAccessTestRuntime(): Promise<PrismaIdentityAccessTestRuntime> {
  const container = await startPostgresContainer()
  const databaseUrl = container.getConnectionUri()
  const migration = runPrismaCommand(
    ['migrate', 'deploy', '--config', 'prisma.config.ts'],
    databaseUrl,
  )
  if (migration.exitCode !== 0) throw new Error('Auth migration failed')
  const environment = buildApiRuntimeConfig({
    DATABASE_URL: databaseUrl,
    REDIS_AUTH_URL: 'redis://default:test@127.0.0.1:6379',
    AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
    AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
    AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
    AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
  })
  const config = new RuntimeConfigService(environment)
  const context = new PrismaTransactionContext()
  const provider = new PrismaClientProvider(config, context)
  const transaction = new PrismaTransactionAdapter(provider, context, config)
  await provider.connect(AbortSignal.timeout(2_000))
  const blocker = new Pool({ connectionString: databaseUrl })

  return {
    provider,
    blocker,
    identity: new PrismaIdentitySecurityStateAdapter(provider),
    credentials: new PrismaPasswordCredentialAdapter(provider, transaction),
    sessions: new PrismaSessionGenerationAdapter(provider, transaction),
    registration: new PrismaRegistrationAdapter(provider, transaction),
    verification: new PrismaEmailVerificationAdapter(provider, transaction),
    recovery: new PrismaPasswordRecoveryAdapter(provider, transaction),
    invitations: new PrismaInvitationAdapter(provider, transaction),
    administrationRead: new PrismaAccountAdministrationReadAdapter(provider),
    administrationMutation: new PrismaAccountAdministrationMutationAdapter(
      provider,
      transaction,
    ),
    async reset(): Promise<void> {
      await provider.withClient(async (client) => {
        await client.approvalRequest.deleteMany()
        await client.user.deleteMany()
        await client.authSecurityState.upsert({
          where: { id: 1 },
          create: { id: 1 },
          update: { adminBootstrapCompletedAt: null, globalSessionEpoch: 0n },
        })
      })
    },
    async close(): Promise<void> {
      await blocker.end()
      await provider.close(AbortSignal.timeout(2_000))
      await stopContainer(container)
    },
  }
}

export async function expectPending<T>(promise: Promise<T>): Promise<void> {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)
}

async function stopContainer(
  container: StartedPostgreSqlContainer,
): Promise<void> {
  await container.stop()
}
