import { isNormalizedEmailUniqueConflict } from '@/modules/auth/infrastructure/prisma-auth-unique-constraint'
import {
  startPrismaIdentityAccessTestRuntime,
  type PrismaIdentityAccessTestRuntime,
} from './support/prisma-identity-access-test-runtime'

describe('Prisma account provisioning and registration adapters', () => {
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

  it('allows exactly one concurrent initial admin bootstrap', async () => {
    const attempts = await Promise.all([
      runtime.provisioning.bootstrapInitialAdmin({
        email: 'First@Example.com',
        normalizedEmail: 'first@example.com',
        passwordHash: 'first-hash',
        emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
      runtime.provisioning.bootstrapInitialAdmin({
        email: 'Second@Example.com',
        normalizedEmail: 'second@example.com',
        passwordHash: 'second-hash',
        emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ])

    expect(attempts.filter((attempt) => attempt.created)).toHaveLength(1)
    await expect(
      runtime.provider.withClient((client) => client.user.count()),
    ).resolves.toBe(1)
  })

  it('creates an unverified roleless account and never mutates a duplicate', async () => {
    const createdAt = new Date('2026-08-06T00:00:00.000Z')
    const firstDigest = Buffer.alloc(32, 1).toString('base64url')
    const secondDigest = Buffer.alloc(32, 2).toString('base64url')
    await expect(
      runtime.registration.registerSelfServiceUser({
        email: 'New@Example.com',
        normalizedEmail: 'new@example.com',
        passwordHash: 'first-hash',
        tokenDigest: firstDigest,
        expiresAt: new Date('2026-08-07T00:00:00.000Z'),
        createdAt,
      }),
    ).resolves.toMatchObject({ created: true, email: 'New@Example.com' })

    await expect(
      runtime.registration.registerSelfServiceUser({
        email: 'Other@Example.com',
        normalizedEmail: 'new@example.com',
        passwordHash: 'second-hash',
        tokenDigest: secondDigest,
        expiresAt: new Date('2026-08-08T00:00:00.000Z'),
        createdAt,
      }),
    ).resolves.toEqual({ created: false })

    await runtime.provider.withClient(async (client) => {
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

  it('propagates a non-email P2002 and rolls back registration', async () => {
    const tokenDigest = Buffer.alloc(32, 46).toString('base64url')
    await runtime.provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'token-owner@example.com',
          normalizedEmail: 'token-owner@example.com',
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
    const before = await runtime.provider.withClient(async (client) => ({
      credentials: await client.passwordCredential.count(),
      users: await client.user.count(),
    }))

    let collision: unknown
    try {
      await runtime.registration.registerSelfServiceUser({
        email: 'must-roll-back@example.com',
        normalizedEmail: 'must-roll-back@example.com',
        passwordHash: 'must-not-persist',
        tokenDigest,
        expiresAt: new Date('2026-08-08T00:00:00.000Z'),
        createdAt: new Date('2026-08-07T00:00:00.000Z'),
      })
    } catch (error: unknown) {
      collision = error
    }

    expect(collision).toMatchObject({ code: 'P2002' })
    expect(isNormalizedEmailUniqueConflict(collision)).toBe(false)
    await runtime.provider.withClient(async (client) => {
      expect(await client.user.count()).toBe(before.users)
      expect(await client.passwordCredential.count()).toBe(before.credentials)
      await expect(
        client.user.findUnique({
          where: { normalizedEmail: 'must-roll-back@example.com' },
        }),
      ).resolves.toBeNull()
    })
  })
})
