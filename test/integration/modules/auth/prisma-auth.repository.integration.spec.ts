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
  let transaction: PrismaTransactionAdapter

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
      REDIS_AUTH_URL: 'redis://default:test@127.0.0.1:6379',
      AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
      AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
      AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
      AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
    })
    const config = new RuntimeConfigService(environment)
    const context = new PrismaTransactionContext()
    provider = new PrismaClientProvider(config, context)
    transaction = new PrismaTransactionAdapter(provider, context, config)
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

  it('deletes a pending reset token inside the credential transition transaction', async () => {
    const user = await provider.withClient(async (client) => {
      const created = await client.user.create({
        data: {
          email: 'change-password@example.com',
          normalizedEmail: 'change-password@example.com',
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          credential: { create: { passwordHash: 'old', version: 2 } },
        },
      })
      await client.passwordResetToken.create({
        data: {
          userId: created.id,
          tokenDigest: Buffer.alloc(32, 7).toString('base64url'),
          expiresAt: new Date('2026-08-07T00:00:00.000Z'),
          createdAt: new Date('2026-08-06T00:00:00.000Z'),
        },
      })
      return created
    })

    await transaction.run(async () => {
      expect(await repository.replacePasswordIfVersion(user.id, 2, 'new')).toBe(
        true,
      )
      await repository.deletePasswordResetToken(user.id)
      await repository.incrementSessionGeneration(user.id)
    })

    await provider.withClient(async (client) => {
      const persisted = await client.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { credential: true },
      })
      expect(persisted.credential?.passwordHash).toBe('new')
      expect(persisted.credential?.version).toBe(3)
      expect(persisted.sessionGeneration).toBe(1n)
      expect(
        await client.passwordResetToken.count({ where: { userId: user.id } }),
      ).toBe(0)
    })
  })

  it('allows exactly one concurrent initial admin bootstrap', async () => {
    const attempts = await Promise.all([
      repository.bootstrapInitialAdmin({
        email: 'First@Example.com',
        normalizedEmail: 'first@example.com',
        passwordHash: 'first-hash',
        emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
      repository.bootstrapInitialAdmin({
        email: 'Second@Example.com',
        normalizedEmail: 'second@example.com',
        passwordHash: 'second-hash',
        emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ])

    expect(attempts.filter((attempt) => attempt.created)).toHaveLength(1)
    await expect(
      provider.withClient((client) => client.user.count()),
    ).resolves.toBe(1)
  })

  it('creates an unverified roleless account and never mutates a duplicate', async () => {
    const createdAt = new Date('2026-08-06T00:00:00.000Z')
    const firstDigest = Buffer.alloc(32, 1).toString('base64url')
    const secondDigest = Buffer.alloc(32, 2).toString('base64url')
    await expect(
      repository.registerSelfServiceUser({
        email: 'New@Example.com',
        normalizedEmail: 'new@example.com',
        passwordHash: 'first-hash',
        tokenDigest: firstDigest,
        expiresAt: new Date('2026-08-07T00:00:00.000Z'),
        createdAt,
      }),
    ).resolves.toMatchObject({ created: true, email: 'New@Example.com' })

    await expect(
      repository.registerSelfServiceUser({
        email: 'Other@Example.com',
        normalizedEmail: 'new@example.com',
        passwordHash: 'second-hash',
        tokenDigest: secondDigest,
        expiresAt: new Date('2026-08-08T00:00:00.000Z'),
        createdAt,
      }),
    ).resolves.toEqual({ created: false })

    await provider.withClient(async (client) => {
      const user = await client.user.findUniqueOrThrow({
        where: { normalizedEmail: 'new@example.com' },
        include: {
          credential: true,
          roles: true,
          emailVerificationToken: true,
        },
      })
      expect(user.email).toBe('New@Example.com')
      expect(user.emailVerifiedAt).toBeNull()
      expect(user.credential?.passwordHash).toBe('first-hash')
      expect(user.roles).toHaveLength(0)
      expect(user.emailVerificationToken?.tokenDigest).toBe(firstDigest)
      expect(user.emailVerificationToken?.tokenDigest).not.toBe(secondDigest)
    })
  })

  it('rotates verification tokens, rejects expired tokens and has one confirmation winner', async () => {
    const user = await provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'verify@example.com',
          normalizedEmail: 'verify@example.com',
          credential: { create: { passwordHash: 'hash' } },
        },
      }),
    )
    const first = {
      tokenDigest: Buffer.alloc(32, 3).toString('base64url'),
      expiresAt: new Date('2026-08-07T00:00:00.000Z'),
      createdAt: new Date('2026-08-06T00:00:00.000Z'),
    }
    const second = {
      tokenDigest: Buffer.alloc(32, 4).toString('base64url'),
      expiresAt: new Date('2026-08-08T00:00:00.000Z'),
      createdAt: new Date('2026-08-06T01:00:00.000Z'),
    }
    await expect(
      repository.rotateEmailVerificationToken(
        user.normalizedEmail,
        first,
        new Date('2026-08-06T00:00:00.000Z'),
      ),
    ).resolves.toEqual({ userId: user.id, email: user.email })
    await expect(
      repository.rotateEmailVerificationToken(
        user.normalizedEmail,
        second,
        new Date('2026-08-06T01:00:00.000Z'),
      ),
    ).resolves.toEqual({ userId: user.id, email: user.email })
    await expect(
      repository.confirmEmailVerification(
        first.tokenDigest,
        new Date('2026-08-06T02:00:00.000Z'),
      ),
    ).resolves.toBeUndefined()

    const winners = await Promise.all([
      repository.confirmEmailVerification(
        second.tokenDigest,
        new Date('2026-08-06T02:00:00.000Z'),
      ),
      repository.confirmEmailVerification(
        second.tokenDigest,
        new Date('2026-08-06T02:00:00.000Z'),
      ),
    ])
    expect(winners.filter((winner) => winner !== undefined)).toHaveLength(1)
    expect(winners.filter((winner) => winner === undefined)).toHaveLength(1)
    await provider.withClient(async (client) => {
      const persisted = await client.user.findUniqueOrThrow({
        where: { id: user.id },
      })
      expect(persisted.emailVerifiedAt).toEqual(
        new Date('2026-08-06T02:00:00.000Z'),
      )
      expect(
        await client.emailVerificationToken.count({
          where: { userId: user.id },
        }),
      ).toBe(0)
    })
  })

  it('rejects disabled accounts and atomically resets a verified password once', async () => {
    const disabled = await provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'disabled-verify@example.com',
          normalizedEmail: 'disabled-verify@example.com',
          status: 'DISABLED',
          emailVerifiedAt: null,
        },
      }),
    )
    await expect(
      repository.rotateEmailVerificationToken(
        disabled.normalizedEmail,
        {
          tokenDigest: Buffer.alloc(32, 5).toString('base64url'),
          expiresAt: new Date('2026-08-07T00:00:00.000Z'),
          createdAt: new Date('2026-08-06T00:00:00.000Z'),
        },
        new Date('2026-08-06T00:00:00.000Z'),
      ),
    ).resolves.toBeUndefined()

    const user = await provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'reset@example.com',
          normalizedEmail: 'reset@example.com',
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          credential: { create: { passwordHash: 'old', version: 4 } },
        },
      }),
    )
    const resetToken = {
      tokenDigest: Buffer.alloc(32, 6).toString('base64url'),
      expiresAt: new Date('2026-08-07T00:00:00.000Z'),
      createdAt: new Date('2026-08-06T00:00:00.000Z'),
    }
    await expect(
      repository.rotatePasswordResetToken(
        user.normalizedEmail,
        resetToken,
        new Date('2026-08-06T00:00:00.000Z'),
      ),
    ).resolves.toEqual({ userId: user.id, email: user.email })
    const results = await Promise.all([
      repository.confirmPasswordReset({
        tokenDigest: resetToken.tokenDigest,
        now: new Date('2026-08-06T02:00:00.000Z'),
        passwordHash: 'new-hash',
      }),
      repository.confirmPasswordReset({
        tokenDigest: resetToken.tokenDigest,
        now: new Date('2026-08-06T02:00:00.000Z'),
        passwordHash: 'losing-hash',
      }),
    ])
    expect(results.filter((result) => result !== undefined)).toHaveLength(1)
    await provider.withClient(async (client) => {
      const persisted = await client.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { credential: true },
      })
      expect(persisted.sessionGeneration).toBe(1n)
      expect(persisted.credential?.version).toBe(5)
      expect(['new-hash', 'losing-hash']).toContain(
        persisted.credential?.passwordHash,
      )
      expect(
        await client.passwordResetToken.count({ where: { userId: user.id } }),
      ).toBe(0)
    })
  })
})
