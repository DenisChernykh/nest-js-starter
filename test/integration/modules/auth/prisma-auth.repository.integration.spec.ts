import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'

import { PrismaAuthRepository } from '@/modules/auth/infrastructure/prisma-auth.repository'
import {
  AuthorizationDeniedError,
  AuthStateConflictError,
} from '@/modules/auth/application/auth-errors'
import { AccountEtagPreconditionFailedError } from '@/modules/auth/application/account-administration.service'
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
  let blocker: Pool

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
    blocker = new Pool({ connectionString: databaseUrl })
  })

  afterEach(async () => {
    await provider.withClient(async (client) => {
      await client.approvalRequest.deleteMany()
      await client.user.deleteMany()
      await client.authSecurityState.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: { adminBootstrapCompletedAt: null, globalSessionEpoch: 0n },
      })
    })
  })

  afterAll(async () => {
    await blocker?.end()
    await provider?.close(AbortSignal.timeout(2_000))
    await container?.stop()
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

  it('rechecks the acting administrator status inside the mutation transaction', async () => {
    const [actor, target] = await provider.withClient((client) =>
      Promise.all([
        client.user.create({
          data: {
            email: 'disabled-actor@example.com',
            normalizedEmail: 'disabled-actor@example.com',
            status: 'DISABLED',
            roles: { create: { roleKey: 'system.admin' } },
          },
        }),
        client.user.create({
          data: {
            email: 'target@example.com',
            normalizedEmail: 'target@example.com',
          },
        }),
      ]),
    )

    await expect(
      repository.changeStatus({
        actorId: actor.id,
        accountId: target.id,
        status: 'disabled',
        expectedRevision: 0,
        actorAuthorization: {
          requiredRoleGroups: [['system.admin']],
        },
      }),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError)
    await expect(repository.getAccount(target.id)).resolves.toMatchObject({
      state: 'active',
      revision: 0,
    })
  })

  it('does not activate an invited account through the status endpoint', async () => {
    const [actor, target] = await provider.withClient((client) =>
      Promise.all([
        client.user.create({
          data: {
            email: 'actor@example.com',
            normalizedEmail: 'actor@example.com',
            roles: { create: { roleKey: 'system.admin' } },
          },
        }),
        client.user.create({
          data: {
            email: 'invited@example.com',
            normalizedEmail: 'invited@example.com',
            status: 'INVITED',
          },
        }),
      ]),
    )

    await expect(
      repository.changeStatus({
        actorId: actor.id,
        accountId: target.id,
        status: 'active',
        expectedRevision: 0,
        actorAuthorization: {
          requiredRoleGroups: [['system.admin']],
        },
      }),
    ).rejects.toBeInstanceOf(AuthStateConflictError)
    await expect(repository.getAccount(target.id)).resolves.toMatchObject({
      state: 'invited',
      revision: 0,
    })
  })

  it('allows exactly one concurrent mutation for one account revision', async () => {
    const [actor, target] = await provider.withClient((client) =>
      Promise.all([
        client.user.create({
          data: {
            email: 'cas-actor@example.com',
            normalizedEmail: 'cas-actor@example.com',
            roles: { create: { roleKey: 'system.admin' } },
          },
        }),
        client.user.create({
          data: {
            email: 'cas-target@example.com',
            normalizedEmail: 'cas-target@example.com',
          },
        }),
      ]),
    )
    const mutation = {
      actorId: actor.id,
      accountId: target.id,
      status: 'disabled' as const,
      expectedRevision: 0,
      actorAuthorization: { requiredRoleGroups: [['system.admin']] },
    }

    const results = await Promise.allSettled([
      repository.changeStatus(mutation),
      repository.changeStatus(mutation),
    ])

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected')
      expect(rejected.reason).toBeInstanceOf(AccountEtagPreconditionFailedError)
    await expect(repository.getAccount(target.id)).resolves.toMatchObject({
      state: 'disabled',
      revision: 1,
    })
  })

  it('advances the strong account revision for every mutable detail field', async () => {
    const tokenDigest = Buffer.alloc(32, 41).toString('base64url')
    const user = await provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'etag-representation@example.com',
          normalizedEmail: 'etag-representation@example.com',
          emailVerificationToken: {
            create: {
              tokenDigest,
              expiresAt: new Date('2026-08-08T00:00:00.000Z'),
              createdAt: new Date('2026-08-07T00:00:00.000Z'),
            },
          },
        },
      }),
    )

    await expect(repository.getAccount(user.id)).resolves.toMatchObject({
      emailVerifiedAt: null,
      revision: 0,
    })
    await expect(
      repository.confirmEmailVerification(
        tokenDigest,
        new Date('2026-08-07T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ userId: user.id })
    await expect(repository.getAccount(user.id)).resolves.toMatchObject({
      emailVerifiedAt: new Date('2026-08-07T12:00:00.000Z'),
      revision: 1,
    })

    await repository.incrementSessionGeneration(user.id)

    await expect(repository.getAccount(user.id)).resolves.toMatchObject({
      revision: 2,
    })
  })

  it('retires identity data while preserving product-owned foreign keys', async () => {
    const originalEmail = 'retire-and-reuse@example.com'
    const [actor, target] = await provider.withClient(async (client) => {
      const actor = await client.user.create({
        data: {
          email: 'retire-actor@example.com',
          normalizedEmail: 'retire-actor@example.com',
          roles: { create: { roleKey: 'system.admin' } },
        },
      })
      const target = await client.user.create({
        data: {
          email: originalEmail,
          normalizedEmail: originalEmail,
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          credential: { create: { passwordHash: 'old-hash' } },
          roles: { create: { roleKey: 'support.operator' } },
          emailVerificationToken: {
            create: {
              tokenDigest: Buffer.alloc(32, 32).toString('base64url'),
              expiresAt: new Date('2026-08-08T00:00:00.000Z'),
              createdAt: new Date('2026-08-07T00:00:00.000Z'),
            },
          },
          passwordResetToken: {
            create: {
              tokenDigest: Buffer.alloc(32, 33).toString('base64url'),
              expiresAt: new Date('2026-08-08T00:00:00.000Z'),
              createdAt: new Date('2026-08-07T00:00:00.000Z'),
            },
          },
        },
      })
      await client.approvalRequest.create({
        data: {
          title: 'Preserved request',
          description: 'Must keep its creator reference after retirement.',
          createdByUserId: target.id,
        },
      })
      return [actor, target]
    })

    await expect(
      repository.retireAccount({
        actorId: actor.id,
        accountId: target.id,
        expectedRevision: 0,
        actorAuthorization: {
          requiredRoleGroups: [['system.admin']],
        },
      }),
    ).resolves.toBe(true)

    await provider.withClient(async (client) => {
      const retired = await client.user.findUniqueOrThrow({
        where: { id: target.id },
        include: {
          credential: true,
          roles: true,
          emailVerificationToken: true,
          passwordResetToken: true,
          createdApprovalRequests: true,
        },
      })
      expect(retired).toMatchObject({
        id: target.id,
        email: `retired+${target.id}@invalid.local`,
        normalizedEmail: `retired+${target.id}@invalid.local`,
        status: 'RETIRED',
        credential: null,
        roles: [],
        emailVerificationToken: null,
        passwordResetToken: null,
      })
      expect(retired.retiredAt).not.toBeNull()
      expect(retired.createdApprovalRequests).toHaveLength(1)
      await expect(
        client.user.create({
          data: {
            email: originalEmail,
            normalizedEmail: originalEmail,
            status: 'INVITED',
          },
        }),
      ).resolves.toMatchObject({ email: originalEmail })
    })
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

  it('checks reset-token eligibility without exposing account state', async () => {
    const now = new Date('2026-08-06T12:00:00.000Z')
    const digests = {
      expired: Buffer.alloc(32, 11).toString('base64url'),
      disabled: Buffer.alloc(32, 12).toString('base64url'),
      unverified: Buffer.alloc(32, 13).toString('base64url'),
      noCredential: Buffer.alloc(32, 14).toString('base64url'),
      eligible: Buffer.alloc(32, 15).toString('base64url'),
    }
    await provider.withClient(async (client) => {
      await client.user.create({
        data: {
          email: 'expired-reset@example.com',
          normalizedEmail: 'expired-reset@example.com',
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          credential: { create: { passwordHash: 'hash' } },
          passwordResetToken: {
            create: {
              tokenDigest: digests.expired,
              expiresAt: new Date('2026-08-06T11:59:59.000Z'),
              createdAt: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        },
      })
      await client.user.create({
        data: {
          email: 'disabled-reset@example.com',
          normalizedEmail: 'disabled-reset@example.com',
          status: 'DISABLED',
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          credential: { create: { passwordHash: 'hash' } },
          passwordResetToken: {
            create: {
              tokenDigest: digests.disabled,
              expiresAt: new Date('2026-08-07T00:00:00.000Z'),
              createdAt: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        },
      })
      await client.user.create({
        data: {
          email: 'unverified-reset@example.com',
          normalizedEmail: 'unverified-reset@example.com',
          emailVerifiedAt: null,
          credential: { create: { passwordHash: 'hash' } },
          passwordResetToken: {
            create: {
              tokenDigest: digests.unverified,
              expiresAt: new Date('2026-08-07T00:00:00.000Z'),
              createdAt: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        },
      })
      await client.user.create({
        data: {
          email: 'no-credential-reset@example.com',
          normalizedEmail: 'no-credential-reset@example.com',
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          passwordResetToken: {
            create: {
              tokenDigest: digests.noCredential,
              expiresAt: new Date('2026-08-07T00:00:00.000Z'),
              createdAt: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        },
      })
      await client.user.create({
        data: {
          email: 'eligible-reset@example.com',
          normalizedEmail: 'eligible-reset@example.com',
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          credential: { create: { passwordHash: 'hash' } },
          passwordResetToken: {
            create: {
              tokenDigest: digests.eligible,
              expiresAt: new Date('2026-08-07T00:00:00.000Z'),
              createdAt: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        },
      })
    })

    await expect(
      repository.isPasswordResetTokenEligible(
        Buffer.alloc(32, 10).toString('base64url'),
        now,
      ),
    ).resolves.toBe(false)
    for (const digest of [
      digests.expired,
      digests.disabled,
      digests.unverified,
      digests.noCredential,
    ]) {
      await expect(
        repository.isPasswordResetTokenEligible(digest, now),
      ).resolves.toBe(false)
    }
    await expect(
      repository.isPasswordResetTokenEligible(digests.eligible, now),
    ).resolves.toBe(true)
  })

  it('serializes disable versus password-reset confirmation with a user lock', async () => {
    const user = await provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'lock-reset-confirm@example.com',
          normalizedEmail: 'lock-reset-confirm@example.com',
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          credential: { create: { passwordHash: 'old' } },
          passwordResetToken: {
            create: {
              tokenDigest: Buffer.alloc(32, 21).toString('base64url'),
              expiresAt: new Date('2026-08-07T00:00:00.000Z'),
              createdAt: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        },
      }),
    )
    const tokenDigest = Buffer.alloc(32, 21).toString('base64url')
    const connection = await blocker.connect()
    try {
      await connection.query('BEGIN')
      await connection.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        user.id,
      ])
      const confirmation = repository.confirmPasswordReset({
        tokenDigest,
        now: new Date('2026-08-06T12:00:00.000Z'),
        passwordHash: 'new',
      })
      await expectPending(confirmation)
      await connection.query(
        "UPDATE users SET status = 'DISABLED' WHERE id = $1",
        [user.id],
      )
      await connection.query('COMMIT')
      await expect(confirmation).resolves.toBeUndefined()
    } finally {
      await connection.query('ROLLBACK').catch(() => undefined)
      connection.release()
    }
    await provider.withClient(async (client) => {
      const persisted = await client.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { credential: true },
      })
      expect(persisted.status).toBe('DISABLED')
      expect(persisted.credential?.passwordHash).toBe('old')
      expect(persisted.sessionGeneration).toBe(0n)
    })
  })

  it('serializes verification confirmation versus resend on the user row', async () => {
    const user = await provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'lock-verification@example.com',
          normalizedEmail: 'lock-verification@example.com',
          emailVerifiedAt: null,
          credential: { create: { passwordHash: 'hash' } },
          emailVerificationToken: {
            create: {
              tokenDigest: Buffer.alloc(32, 22).toString('base64url'),
              expiresAt: new Date('2026-08-07T00:00:00.000Z'),
              createdAt: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        },
      }),
    )
    const oldDigest = Buffer.alloc(32, 22).toString('base64url')
    const newDigest = Buffer.alloc(32, 23).toString('base64url')
    const connection = await blocker.connect()
    try {
      await connection.query('BEGIN')
      await connection.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        user.id,
      ])
      const confirmation = repository.confirmEmailVerification(
        oldDigest,
        new Date('2026-08-06T12:00:00.000Z'),
      )
      await expectPending(confirmation)
      const resend = repository.rotateEmailVerificationToken(
        user.normalizedEmail,
        {
          tokenDigest: newDigest,
          expiresAt: new Date('2026-08-08T00:00:00.000Z'),
          createdAt: new Date('2026-08-06T12:01:00.000Z'),
        },
        new Date('2026-08-06T12:00:00.000Z'),
      )
      await expectPending(resend)
      await connection.query('COMMIT')
      const [confirmed, resent] = await Promise.all([confirmation, resend])
      expect(
        [confirmed !== undefined, resent !== undefined].filter(Boolean),
      ).toHaveLength(1)
      await provider.withClient(async (client) => {
        const persisted = await client.user.findUniqueOrThrow({
          where: { id: user.id },
          include: { emailVerificationToken: true },
        })
        expect(
          persisted.emailVerifiedAt === null &&
            persisted.emailVerificationToken?.tokenDigest === newDigest,
        ).toBe(resent !== undefined)
      })
    } finally {
      await connection.query('ROLLBACK').catch(() => undefined)
      connection.release()
    }
  })

  it('serializes password change versus password-reset request', async () => {
    const user = await provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'lock-reset-request@example.com',
          normalizedEmail: 'lock-reset-request@example.com',
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          credential: { create: { passwordHash: 'old', version: 2 } },
          passwordResetToken: {
            create: {
              tokenDigest: Buffer.alloc(32, 25).toString('base64url'),
              expiresAt: new Date('2026-08-07T00:00:00.000Z'),
              createdAt: new Date('2026-08-06T00:00:00.000Z'),
            },
          },
        },
      }),
    )
    const connection = await blocker.connect()
    try {
      await connection.query('BEGIN')
      await connection.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        user.id,
      ])
      const resetRequest = repository.rotatePasswordResetToken(
        user.normalizedEmail,
        {
          tokenDigest: Buffer.alloc(32, 24).toString('base64url'),
          expiresAt: new Date('2026-08-07T00:00:00.000Z'),
          createdAt: new Date('2026-08-06T00:00:00.000Z'),
        },
        new Date('2026-08-06T12:00:00.000Z'),
      )
      await expectPending(resetRequest)
      const passwordChange = transaction.run(async () => {
        expect(
          await repository.replacePasswordIfVersion(user.id, 2, 'new'),
        ).toBe(true)
        await repository.deletePasswordResetToken(user.id)
        await repository.incrementSessionGeneration(user.id)
      })
      await expectPending(passwordChange)
      await connection.query('COMMIT')
      await expect(resetRequest).resolves.toEqual({
        userId: user.id,
        email: user.email,
      })
      await expect(passwordChange).resolves.toBeUndefined()
    } finally {
      await connection.query('ROLLBACK').catch(() => undefined)
      connection.release()
    }
    await provider.withClient(async (client) => {
      const persisted = await client.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { credential: true },
      })
      expect(persisted.status).toBe('ACTIVE')
      expect(persisted.credential?.passwordHash).toBe('new')
      expect(persisted.sessionGeneration).toBe(1n)
      expect(
        await client.passwordResetToken.count({ where: { userId: user.id } }),
      ).toBe(0)
    })
  })
})

async function expectPending<T>(promise: Promise<T>): Promise<void> {
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
