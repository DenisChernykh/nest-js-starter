import {
  expectPending,
  startPrismaIdentityAccessTestRuntime,
  type PrismaIdentityAccessTestRuntime,
} from './support/prisma-identity-access-test-runtime'

describe('Prisma password recovery adapter', () => {
  let runtime: PrismaIdentityAccessTestRuntime

  beforeAll(async () => {
    runtime = await startPrismaIdentityAccessTestRuntime()
  })

  afterEach(async () => {
    await runtime.reset()
  })

  afterAll(async () => {
    await runtime.close()
  })

  it('isolates administrator password-reset tokens from self-service confirmation', async () => {
    const [actor, target] = await runtime.provider.withClient((client) =>
      Promise.all([
        client.user.create({
          data: {
            email: 'reset-actor@example.com',
            normalizedEmail: 'reset-actor@example.com',
            roles: { create: { roleKey: 'system.admin' } },
          },
        }),
        client.user.create({
          data: {
            email: 'admin-reset-target@example.com',
            normalizedEmail: 'admin-reset-target@example.com',
            emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
            credential: { create: { passwordHash: 'old-hash' } },
          },
        }),
      ]),
    )
    const tokenDigest = Buffer.alloc(32, 42).toString('base64url')
    const now = new Date('2026-08-07T12:00:00.000Z')

    await expect(
      runtime.recovery.rotateAdministratorPasswordReset({
        actorId: actor.id,
        accountId: target.id,
        actorAuthorization: { requiredRoleGroups: [['system.admin']] },
        token: {
          tokenDigest,
          expiresAt: new Date('2026-08-07T12:30:00.000Z'),
          createdAt: now,
        },
        now,
      }),
    ).resolves.toEqual({ userId: target.id, email: target.email })
    await expect(
      runtime.recovery.getEligiblePasswordResetTokenSource(tokenDigest, now),
    ).resolves.toBe('administrator')
    await expect(
      runtime.recovery.confirmPasswordReset({
        tokenDigest,
        source: 'self-service',
        passwordHash: 'wrong-boundary',
        now,
      }),
    ).resolves.toBeUndefined()
    await expect(
      runtime.recovery.confirmPasswordReset({
        tokenDigest,
        source: 'administrator',
        passwordHash: 'new-hash',
        now,
      }),
    ).resolves.toEqual({ userId: target.id, email: target.email })
    await expect(
      runtime.recovery.getEligiblePasswordResetTokenSource(tokenDigest, now),
    ).resolves.toBeUndefined()
  })

  it('rejects disabled accounts and atomically resets a verified password once', async () => {
    const disabled = await runtime.provider.withClient((client) =>
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
      runtime.verification.rotateEmailVerificationToken(
        disabled.normalizedEmail,
        {
          tokenDigest: Buffer.alloc(32, 5).toString('base64url'),
          expiresAt: new Date('2026-08-07T00:00:00.000Z'),
          createdAt: new Date('2026-08-06T00:00:00.000Z'),
        },
        new Date('2026-08-06T00:00:00.000Z'),
      ),
    ).resolves.toBeUndefined()

    const user = await runtime.provider.withClient((client) =>
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
      runtime.recovery.rotatePasswordResetToken(
        user.normalizedEmail,
        resetToken,
        new Date('2026-08-06T00:00:00.000Z'),
      ),
    ).resolves.toEqual({ userId: user.id, email: user.email })
    const results = await Promise.all([
      runtime.recovery.confirmPasswordReset({
        tokenDigest: resetToken.tokenDigest,
        source: 'self-service',
        now: new Date('2026-08-06T02:00:00.000Z'),
        passwordHash: 'new-hash',
      }),
      runtime.recovery.confirmPasswordReset({
        tokenDigest: resetToken.tokenDigest,
        source: 'self-service',
        now: new Date('2026-08-06T02:00:00.000Z'),
        passwordHash: 'losing-hash',
      }),
    ])
    expect(results.filter((result) => result !== undefined)).toHaveLength(1)
    await runtime.provider.withClient(async (client) => {
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
    await runtime.provider.withClient(async (client) => {
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
      runtime.recovery.getEligiblePasswordResetTokenSource(
        Buffer.alloc(32, 10).toString('base64url'),
        now,
      ),
    ).resolves.toBeUndefined()
    for (const digest of [
      digests.expired,
      digests.disabled,
      digests.unverified,
      digests.noCredential,
    ]) {
      await expect(
        runtime.recovery.getEligiblePasswordResetTokenSource(digest, now),
      ).resolves.toBeUndefined()
    }
    await expect(
      runtime.recovery.getEligiblePasswordResetTokenSource(
        digests.eligible,
        now,
      ),
    ).resolves.toBe('self-service')
  })

  it('serializes disable versus password-reset confirmation with a user lock', async () => {
    const user = await runtime.provider.withClient((client) =>
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
    const connection = await runtime.blocker.connect()
    try {
      await connection.query('BEGIN')
      await connection.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        user.id,
      ])
      const confirmation = runtime.recovery.confirmPasswordReset({
        tokenDigest,
        source: 'self-service',
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
    await runtime.provider.withClient(async (client) => {
      const persisted = await client.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { credential: true },
      })
      expect(persisted.status).toBe('DISABLED')
      expect(persisted.credential?.passwordHash).toBe('old')
      expect(persisted.sessionGeneration).toBe(0n)
    })
  })
})
