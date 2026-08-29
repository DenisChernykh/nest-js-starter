import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { verify as argon2Verify } from 'argon2'

import { API_ROLE_DEFINITIONS } from '@/bootstrap/api/api-auth.roles'
import type { CreateUserUseCase } from '@/modules/identity-access/account-administration/provisioning/application/create-user.use-case'
import { createUserCommand } from '@/modules/identity-access/composition/user-provisioning.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionAdapter } from '@/platform/database/prisma-transaction.adapter'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { runPrismaCommand } from '@test/integration/support/run-prisma-command'

describe('CreateUserUseCase integration', () => {
  let container: StartedPostgreSqlContainer
  let provider: PrismaClientProvider
  let useCase: CreateUserUseCase

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
      REDIS_AUTH_URL: 'redis://127.0.0.1:6379',
      AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
      AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
      AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
      AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
    })
    const config = new RuntimeConfigService(environment)
    const context = new PrismaTransactionContext()
    provider = new PrismaClientProvider(config, context)
    const transaction = new PrismaTransactionAdapter(provider, context, config)
    useCase = createUserCommand(
      provider,
      transaction,
      { emit: () => undefined },
      API_ROLE_DEFINITIONS,
    )
    await provider.connect(AbortSignal.timeout(2_000))
  })

  afterAll(async () => {
    await provider.close(AbortSignal.timeout(2_000))
    await container.stop()
  })

  it('creates a roleless user with one Argon2 credential and no roles', async () => {
    const result = await useCase.execute({
      email: 'requester@example.com',
      password: 'requester password',
      roleKeys: [],
    })

    expect(result.created).toBe(true)
    await provider.withClient(async (client) => {
      expect(
        await client.user.count({
          where: { normalizedEmail: 'requester@example.com' },
        }),
      ).toBe(1)
      const requester = await client.user.findUniqueOrThrow({
        where: { normalizedEmail: 'requester@example.com' },
        select: { emailVerifiedAt: true },
      })
      expect(requester.emailVerifiedAt).toBeInstanceOf(Date)
      const credential = await client.passwordCredential.findFirstOrThrow({
        where: { user: { normalizedEmail: 'requester@example.com' } },
      })
      expect(credential.passwordHash).toMatch(/^\$argon2id\$/u)
      expect(
        await client.userRole.count({
          where: { user: { normalizedEmail: 'requester@example.com' } },
        }),
      ).toBe(0)
    })
  })

  it('creates one reviewer assignment whose credential authenticates', async () => {
    await useCase.execute({
      email: 'Reviewer@Example.com',
      password: 'reviewer password',
      roleKeys: ['approval.reviewer', 'approval.reviewer'],
    })

    const credential = await provider.withClient((client) =>
      client.passwordCredential.findFirst({
        where: { user: { normalizedEmail: 'reviewer@example.com' } },
      }),
    )
    await expect(
      argon2Verify(credential?.passwordHash ?? '', 'reviewer password'),
    ).resolves.toBe(true)
    await provider.withClient(async (client) => {
      expect(
        await client.userRole.count({
          where: {
            user: { normalizedEmail: 'reviewer@example.com' },
            roleKey: 'approval.reviewer',
          },
        }),
      ).toBe(1)
    })
  })

  it('commits exactly one concurrent case-insensitive email and no partial rows', async () => {
    const before = await provider.withClient(async (client) => ({
      credentials: await client.passwordCredential.count(),
      roles: await client.userRole.count(),
      users: await client.user.count(),
    }))

    const results = await Promise.all([
      useCase.execute({
        email: 'Concurrent@Example.com',
        password: 'first concurrent password',
        roleKeys: ['approval.reviewer'],
      }),
      useCase.execute({
        email: 'concurrent@example.com',
        password: 'second concurrent password',
        roleKeys: ['approval.reviewer'],
      }),
    ])

    expect(results.filter((result) => result.created)).toHaveLength(1)
    expect(results.filter((result) => !result.created)).toEqual([
      { created: false },
    ])
    await provider.withClient(async (client) => {
      expect(await client.user.count()).toBe(before.users + 1)
      expect(await client.passwordCredential.count()).toBe(
        before.credentials + 1,
      )
      expect(await client.userRole.count()).toBe(before.roles + 1)
      expect(
        await client.user.count({
          where: { normalizedEmail: 'concurrent@example.com' },
        }),
      ).toBe(1)
    })
  })
})
