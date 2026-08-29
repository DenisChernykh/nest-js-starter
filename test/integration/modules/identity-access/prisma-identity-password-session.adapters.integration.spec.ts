import {
  expectPending,
  startPrismaIdentityAccessTestRuntime,
  type PrismaIdentityAccessTestRuntime,
} from './support/prisma-identity-access-test-runtime'
import { SessionIssuer } from '@/modules/identity-access/sessions/application/session-issuer'
import type {
  IssueSessionInput,
  SessionStorePort,
} from '@/modules/identity-access/sessions/application/session-store.port'

describe('Prisma identity, password credential and session adapters', () => {
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

  it('keeps credential projection minimal and identity projection authoritative', async () => {
    const userId = await runtime.provider.withClient(async (client) => {
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
      runtime.credentials.findCredentialByNormalizedEmail('admin@example.com'),
    ).resolves.toEqual({
      userId,
      status: 'active',
      emailVerifiedAt: undefined,
      passwordHash: '$argon2id$fixture',
      passwordVersion: 0,
    })
    await expect(
      runtime.identity.findAuthProjectionByUserId(userId),
    ).resolves.toEqual(
      expect.objectContaining({
        email: 'Admin@Example.com',
        normalizedEmail: 'admin@example.com',
        roleKeys: ['system.admin', 'unknown.future'],
      }),
    )
  })

  it('preserves disabled status and unknown roles in request projection', async () => {
    const user = await runtime.provider.withClient((client) =>
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
      runtime.identity.findAuthProjectionByUserId(user.id),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'disabled',
        roleKeys: ['future.role'],
      }),
    )
  })

  it('treats the missing singleton as an integrity failure', async () => {
    await runtime.provider.withClient((client) =>
      client.authSecurityState.deleteMany(),
    )

    await expect(runtime.identity.readGlobalSessionEpoch()).rejects.toThrow(
      'Auth security state is missing',
    )
  })

  it('conditionally replaces a password and increments generation', async () => {
    const user = await runtime.provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'user@example.com',
          normalizedEmail: 'user@example.com',
          credential: { create: { passwordHash: 'old', version: 2 } },
        },
      }),
    )

    await expect(
      runtime.credentials.replacePasswordIfVersion(user.id, 1, 'wrong'),
    ).resolves.toBe(false)
    await expect(
      runtime.credentials.replacePasswordIfVersion(user.id, 2, 'new'),
    ).resolves.toBe(true)
    await expect(
      runtime.sessions.incrementSessionGeneration(user.id),
    ).resolves.toBe(1n)
  })

  it('advances the strong account revision for every mutable detail field', async () => {
    const tokenDigest = Buffer.alloc(32, 41).toString('base64url')
    const user = await runtime.provider.withClient((client) =>
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

    await expect(
      runtime.administrationRead.getAccount(user.id),
    ).resolves.toMatchObject({
      emailVerifiedAt: null,
      revision: 0,
    })
    await expect(
      runtime.verification.confirmEmailVerification(
        tokenDigest,
        new Date('2026-08-07T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ userId: user.id })
    await expect(
      runtime.administrationRead.getAccount(user.id),
    ).resolves.toMatchObject({
      emailVerifiedAt: new Date('2026-08-07T12:00:00.000Z'),
      revision: 1,
    })

    await runtime.sessions.incrementSessionGeneration(user.id)

    await expect(
      runtime.administrationRead.getAccount(user.id),
    ).resolves.toMatchObject({
      revision: 2,
    })
  })

  it('deletes a pending reset token inside the credential transition transaction', async () => {
    const user = await runtime.provider.withClient(async (client) => {
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

    await expect(
      runtime.credentials.changePasswordAndInvalidate({
        userId: user.id,
        expectedVersion: 2,
        passwordHash: 'new',
      }),
    ).resolves.toBe(true)

    await runtime.provider.withClient(async (client) => {
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

  it('serializes password change versus password-reset request', async () => {
    const user = await runtime.provider.withClient((client) =>
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
    const connection = await runtime.blocker.connect()
    try {
      await connection.query('BEGIN')
      await connection.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        user.id,
      ])
      const resetRequest = runtime.recovery.rotatePasswordResetToken(
        user.normalizedEmail,
        {
          tokenDigest: Buffer.alloc(32, 24).toString('base64url'),
          expiresAt: new Date('2026-08-07T00:00:00.000Z'),
          createdAt: new Date('2026-08-06T00:00:00.000Z'),
        },
        new Date('2026-08-06T12:00:00.000Z'),
      )
      await expectPending(resetRequest)
      const passwordChange = runtime.credentials.changePasswordAndInvalidate({
        userId: user.id,
        expectedVersion: 2,
        passwordHash: 'new',
      })
      await expectPending(passwordChange)
      await connection.query('COMMIT')
      await expect(resetRequest).resolves.toEqual({
        userId: user.id,
        email: user.email,
      })
      await expect(passwordChange).resolves.toBe(true)
    } finally {
      await connection.query('ROLLBACK').catch(() => undefined)
      connection.release()
    }
    await runtime.provider.withClient(async (client) => {
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

  it('holds the credential fence through session issuance before password invalidation', async () => {
    const user = await runtime.provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'login-fence@example.com',
          normalizedEmail: 'login-fence@example.com',
          emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          credential: { create: { passwordHash: 'old', version: 2 } },
        },
      }),
    )
    let enterIssuance: (() => void) | undefined
    const issuanceEntered = new Promise<void>((resolve) => {
      enterIssuance = resolve
    })
    let releaseIssuance: (() => void) | undefined
    const issuanceReleased = new Promise<void>((resolve) => {
      releaseIssuance = resolve
    })
    let issuedInput: IssueSessionInput | undefined
    const issuer = new SessionIssuer(runtime.identity, {
      issue: async (input: IssueSessionInput) => {
        issuedInput = input
        enterIssuance?.()
        await issuanceReleased
        return {
          rawToken: 'raw',
          publicId: 'public',
          csrfToken: 'csrf',
          absoluteExpiresAt: new Date('2026-08-08T00:00:00.000Z'),
        }
      },
    } as unknown as SessionStorePort)

    const fencedIssuance = runtime.credentials.withinCredentialVersionFence(
      user.id,
      (snapshot) => {
        expect(snapshot?.passwordVersion).toBe(2)
        return issuer.issue({
          userId: user.id,
          nowMs: 1_000,
          deviceLabel: 'browser',
          networkFingerprint: 'network',
        })
      },
    )
    await issuanceEntered

    const passwordChange = runtime.credentials.changePasswordAndInvalidate({
      userId: user.id,
      expectedVersion: 2,
      passwordHash: 'new',
    })
    await expectPending(passwordChange)

    releaseIssuance?.()
    await expect(fencedIssuance).resolves.toMatchObject({ publicId: 'public' })
    await expect(passwordChange).resolves.toBe(true)
    expect(issuedInput).toEqual(
      expect.objectContaining({ userId: user.id, sessionGeneration: 0n }),
    )
    await expect(
      runtime.identity.findAuthProjectionByUserId(user.id),
    ).resolves.toMatchObject({ sessionGeneration: 1n })
  })
})
