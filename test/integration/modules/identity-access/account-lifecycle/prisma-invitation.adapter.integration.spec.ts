import { AuthorizationDeniedError } from '@/modules/identity-access/public-contracts/auth-errors'
import {
  startPrismaIdentityAccessTestRuntime,
  type PrismaIdentityAccessTestRuntime,
} from '../support/prisma-identity-access-test-runtime'

describe('Prisma invitation adapter', () => {
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

  it('reauthorizes invitation administrators inside the creation transaction', async () => {
    const actor = await runtime.provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'revoked-invite-actor@example.com',
          normalizedEmail: 'revoked-invite-actor@example.com',
          roles: { create: { roleKey: 'unrelated.role' } },
        },
      }),
    )

    await expect(
      runtime.invitations.createInvitation({
        actorId: actor.id,
        actorAuthorization: {
          requiredRoleGroups: [['system.admin']],
        },
        email: 'must-not-exist@example.com',
        normalizedEmail: 'must-not-exist@example.com',
        roleKeys: [],
        tokenDigest: Buffer.alloc(32, 30).toString('base64url'),
        expiresAt: new Date('2026-08-08T00:00:00.000Z'),
        createdAt: new Date('2026-08-07T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError)
    await expect(
      runtime.provider.withClient((client) =>
        client.user.count({
          where: { normalizedEmail: 'must-not-exist@example.com' },
        }),
      ),
    ).resolves.toBe(0)
  })

  it('accepts one invitation token exactly once under concurrency', async () => {
    const tokenDigest = Buffer.alloc(32, 31).toString('base64url')
    const invited = await runtime.provider.withClient((client) =>
      client.user.create({
        data: {
          email: 'single-use-invite@example.com',
          normalizedEmail: 'single-use-invite@example.com',
          status: 'INVITED',
          invitationToken: {
            create: {
              tokenDigest,
              expiresAt: new Date('2026-08-08T00:00:00.000Z'),
              createdAt: new Date('2026-08-07T00:00:00.000Z'),
            },
          },
        },
      }),
    )

    const results = await Promise.all([
      runtime.invitations.acceptInvitation({
        tokenDigest,
        passwordHash: 'first-hash',
        now: new Date('2026-08-07T12:00:00.000Z'),
      }),
      runtime.invitations.acceptInvitation({
        tokenDigest,
        passwordHash: 'second-hash',
        now: new Date('2026-08-07T12:00:00.000Z'),
      }),
    ])

    expect(results.sort()).toEqual([false, true])
    await runtime.provider.withClient(async (client) => {
      const persisted = await client.user.findUniqueOrThrow({
        where: { id: invited.id },
        include: { credential: true, invitationToken: true },
      })
      expect(persisted.status).toBe('ACTIVE')
      expect(persisted.emailVerifiedAt).not.toBeNull()
      expect(['first-hash', 'second-hash']).toContain(
        persisted.credential?.passwordHash,
      )
      expect(persisted.invitationToken).toBeNull()
    })
  })

  it('rotates invitation tokens and rejects both replaced and expired values', async () => {
    const oldDigest = Buffer.alloc(32, 43).toString('base64url')
    const newDigest = Buffer.alloc(32, 44).toString('base64url')
    const [actor, invited, expired] = await runtime.provider.withClient(
      (client) =>
        Promise.all([
          client.user.create({
            data: {
              email: 'resend-actor@example.com',
              normalizedEmail: 'resend-actor@example.com',
              roles: { create: { roleKey: 'system.admin' } },
            },
          }),
          client.user.create({
            data: {
              email: 'resend-invited@example.com',
              normalizedEmail: 'resend-invited@example.com',
              status: 'INVITED',
              invitationToken: {
                create: {
                  tokenDigest: oldDigest,
                  expiresAt: new Date('2026-08-08T00:00:00.000Z'),
                  createdAt: new Date('2026-08-07T00:00:00.000Z'),
                },
              },
            },
          }),
          client.user.create({
            data: {
              email: 'expired-invited@example.com',
              normalizedEmail: 'expired-invited@example.com',
              status: 'INVITED',
              invitationToken: {
                create: {
                  tokenDigest: Buffer.alloc(32, 45).toString('base64url'),
                  expiresAt: new Date('2026-08-07T11:59:59.000Z'),
                  createdAt: new Date('2026-08-06T00:00:00.000Z'),
                },
              },
            },
          }),
        ]),
    )
    const now = new Date('2026-08-07T12:00:00.000Z')

    await expect(
      runtime.invitations.resendInvitation({
        actorId: actor.id,
        accountId: invited.id,
        actorAuthorization: { requiredRoleGroups: [['system.admin']] },
        token: {
          tokenDigest: newDigest,
          expiresAt: new Date('2026-08-08T12:00:00.000Z'),
          createdAt: now,
        },
        now,
      }),
    ).resolves.toEqual({ userId: invited.id, email: invited.email })
    await expect(
      runtime.invitations.isInvitationTokenEligible(oldDigest, now),
    ).resolves.toBe(false)
    await expect(
      runtime.invitations.isInvitationTokenEligible(newDigest, now),
    ).resolves.toBe(true)
    await expect(
      runtime.invitations.acceptInvitation({
        tokenDigest: oldDigest,
        passwordHash: 'replaced-token-hash',
        now,
      }),
    ).resolves.toBe(false)
    await expect(
      runtime.invitations.acceptInvitation({
        tokenDigest: Buffer.alloc(32, 45).toString('base64url'),
        passwordHash: 'expired-token-hash',
        now,
      }),
    ).resolves.toBe(false)
    await expect(
      runtime.administrationRead.getAccount(expired.id),
    ).resolves.toMatchObject({
      state: 'invited',
    })
  })
})
