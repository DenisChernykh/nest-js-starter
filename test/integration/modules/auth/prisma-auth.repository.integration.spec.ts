import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import { PrismaAuthRepository } from '@/modules/auth/infrastructure/prisma-auth.repository'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionAdapter } from '@/platform/database/prisma-transaction.adapter'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { runPrismaCommand } from '@test/integration/support/run-prisma-command'

describe('PrismaAuthRepository', () => {
  let container: StartedPostgreSqlContainer
  let provider: PrismaClientProvider
  let repository: PrismaAuthRepository

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
      REDIS_COORDINATION_URL: 'redis://default:test@127.0.0.1:6379',
      AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
      AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
      AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
      AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
    })
    const config = new RuntimeConfigService(environment)
    const context = new PrismaTransactionContext()
    provider = new PrismaClientProvider(config, context)
    const transaction = new PrismaTransactionAdapter(provider, context, config)
    repository = new PrismaAuthRepository(provider, transaction)
    await provider.connect(AbortSignal.timeout(2_000))
  })

  afterEach(async () => {
    await provider.withClient(async (client) => {
      await client.user.deleteMany()
      await client.authSecurityState.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: { adminBootstrapCompletedAt: null, globalSessionEpoch: 0n },
      })
    })
  })

  afterAll(async () => {
    await provider.close(AbortSignal.timeout(2_000))
    await container.stop()
  })

  it('retains original email, enforces normalized uniqueness and sorts roles', async () => {
    const userId = await provider.withClient(async (client) => {
      const user = await client.user.create({
        data: {
          email: 'Admin@Example.com',
          normalizedEmail: 'admin@example.com',
          credential: {
            create: { passwordHash: '$argon2id$fixture' },
          },
          roles: {
            create: [
              { roleKey: 'unknown.future' },
              { roleKey: 'system.admin' },
            ],
          },
        },
      })
      await expect(
        client.user.create({
          data: {
            email: 'Other spelling',
            normalizedEmail: 'admin@example.com',
          },
        }),
      ).rejects.toThrow()
      return user.id
    })

    await expect(
      repository.findCredentialByNormalizedEmail('admin@example.com'),
    ).resolves.toEqual(
      expect.objectContaining({
        userId,
        email: 'Admin@Example.com',
        roleKeys: ['system.admin', 'unknown.future'],
      }),
    )
  })

  it('preserves disabled status and unknown roles in request projection', async () => {
    const user = await provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'disabled@example.com',
          normalizedEmail: 'disabled@example.com',
          status: 'DISABLED',
          roles: { create: { roleKey: 'future.role' } },
        },
      }),
    )

    await expect(
      repository.findAuthProjectionByUserId(user.id),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'disabled',
        roleKeys: ['future.role'],
      }),
    )
  })

  it('treats the missing singleton as an integrity failure', async () => {
    await provider.withClient((client) => client.authSecurityState.deleteMany())

    await expect(repository.readGlobalSessionEpoch()).rejects.toThrow(
      'Auth security state is missing',
    )
  })

  it('conditionally replaces a password and increments generation', async () => {
    const user = await provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'user@example.com',
          normalizedEmail: 'user@example.com',
          credential: { create: { passwordHash: 'old', version: 2 } },
        },
      }),
    )

    await expect(
      repository.replacePasswordIfVersion(user.id, 1, 'wrong'),
    ).resolves.toBe(false)
    await expect(
      repository.replacePasswordIfVersion(user.id, 2, 'new'),
    ).resolves.toBe(true)
    await expect(repository.incrementSessionGeneration(user.id)).resolves.toBe(
      1n,
    )
  })

  it('allows exactly one concurrent initial admin bootstrap', async () => {
    const attempts = await Promise.all([
      repository.bootstrapInitialAdmin({
        email: 'First@Example.com',
        normalizedEmail: 'first@example.com',
        passwordHash: 'first-hash',
      }),
      repository.bootstrapInitialAdmin({
        email: 'Second@Example.com',
        normalizedEmail: 'second@example.com',
        passwordHash: 'second-hash',
      }),
    ])

    expect(attempts.filter((attempt) => attempt.created)).toHaveLength(1)
    await expect(
      provider.withClient((client) => client.user.count()),
    ).resolves.toBe(1)
  })
})
