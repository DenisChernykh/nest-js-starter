import {
  expectPending,
  startPrismaIdentityAccessTestRuntime,
  type PrismaIdentityAccessTestRuntime,
} from '../support/prisma-identity-access-test-runtime'

describe('Prisma email verification adapter', () => {
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

  it('rotates verification tokens, rejects expired tokens and has one confirmation winner', async () => {
    const user = await runtime.provider.withClient((client) =>
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
      runtime.verification.rotateEmailVerificationToken(
        user.normalizedEmail,
        first,
        new Date('2026-08-06T00:00:00.000Z'),
      ),
    ).resolves.toEqual({ userId: user.id, email: user.email })
    await expect(
      runtime.verification.rotateEmailVerificationToken(
        user.normalizedEmail,
        second,
        new Date('2026-08-06T01:00:00.000Z'),
      ),
    ).resolves.toEqual({ userId: user.id, email: user.email })
    await expect(
      runtime.verification.confirmEmailVerification(
        first.tokenDigest,
        new Date('2026-08-06T02:00:00.000Z'),
      ),
    ).resolves.toBeUndefined()

    const winners = await Promise.all([
      runtime.verification.confirmEmailVerification(
        second.tokenDigest,
        new Date('2026-08-06T02:00:00.000Z'),
      ),
      runtime.verification.confirmEmailVerification(
        second.tokenDigest,
        new Date('2026-08-06T02:00:00.000Z'),
      ),
    ])
    expect(winners.filter((winner) => winner !== undefined)).toHaveLength(1)
    expect(winners.filter((winner) => winner === undefined)).toHaveLength(1)
    await runtime.provider.withClient(async (client) => {
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

  it('serializes verification confirmation versus resend on the user row', async () => {
    const user = await runtime.provider.withClient((client) =>
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
    const connection = await runtime.blocker.connect()
    try {
      await connection.query('BEGIN')
      await connection.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        user.id,
      ])
      const confirmation = runtime.verification.confirmEmailVerification(
        oldDigest,
        new Date('2026-08-06T12:00:00.000Z'),
      )
      await expectPending(confirmation)
      const resend = runtime.verification.rotateEmailVerificationToken(
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
      await runtime.provider.withClient(async (client) => {
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
})
