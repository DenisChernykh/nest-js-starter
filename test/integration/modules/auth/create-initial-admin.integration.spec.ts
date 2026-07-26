import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import { CreateInitialAdminUseCase } from '@/modules/auth/application/create-initial-admin.use-case'
import { Argon2PasswordHasher } from '@/modules/auth/infrastructure/argon2-password.hasher'
import { PrismaAuthRepository } from '@/modules/auth/infrastructure/prisma-auth.repository'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionAdapter } from '@/platform/database/prisma-transaction.adapter'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { runPrismaCommand } from '@test/integration/support/run-prisma-command'

describe('CreateInitialAdminUseCase', () => {
  let container: StartedPostgreSqlContainer
  let provider: PrismaClientProvider
  let useCase: CreateInitialAdminUseCase

  beforeAll(async () => {
    container = await startPostgresContainer()
    const databaseUrl = container.getConnectionUri()
    const migration = runPrismaCommand(
      ['migrate', 'deploy', '--config', 'prisma.config.ts'],
      databaseUrl,
    )
    if (migration.exitCode !== 0) throw new Error('Auth migration failed')
    const environment = buildApiRuntimeConfig({
      DATABASE_URL: databaseUrl,
      REDIS_COORDINATION_URL: 'redis://127.0.0.1:6379',
      AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
      AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
      AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
      AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
    })
    const config = new RuntimeConfigService(environment)
    const context = new PrismaTransactionContext()
    provider = new PrismaClientProvider(config, context)
    const transaction = new PrismaTransactionAdapter(provider, context, config)
    const repository = new PrismaAuthRepository(provider, transaction)
    useCase = new CreateInitialAdminUseCase(
      repository,
      new Argon2PasswordHasher(),
    )
    await provider.connect(AbortSignal.timeout(2_000))
  })

  afterAll(async () => {
    await provider.close(AbortSignal.timeout(2_000))
    await container.stop()
  })

  it('commits exactly one administrator across concurrent attempts', async () => {
    const results = await Promise.all([
      useCase.execute({
        email: 'Admin@One.example',
        password: 'first sufficiently long password',
      }),
      useCase.execute({
        email: 'Admin@Two.example',
        password: 'second sufficiently long password',
      }),
    ])

    expect(results.filter((result) => result.created)).toHaveLength(1)
    await provider.withClient(async (client) => {
      expect(await client.user.count()).toBe(1)
      expect(
        await client.userRole.count({ where: { roleKey: 'system.admin' } }),
      ).toBe(1)
      const state = await client.authSecurityState.findUniqueOrThrow({
        where: { id: 1 },
      })
      expect(state.adminBootstrapCompletedAt).toBeInstanceOf(Date)
    })
  })
})
