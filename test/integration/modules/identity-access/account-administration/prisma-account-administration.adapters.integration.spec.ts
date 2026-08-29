import { AccountRevisionConflictError } from '@/modules/identity-access/account-administration/application/account-administration.errors'
import {
  AuthorizationDeniedError,
  AuthStateConflictError,
} from '@/modules/identity-access/public-contracts/auth-errors'
import {
  startPrismaIdentityAccessTestRuntime,
  type PrismaIdentityAccessTestRuntime,
} from '../support/prisma-identity-access-test-runtime'

describe('Prisma account administration adapters', () => {
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

  it('rechecks the acting administrator status inside the mutation transaction', async () => {
    const [actor, target] = await runtime.provider.withClient((client) =>
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
      runtime.administrationMutation.changeStatus({
        actorId: actor.id,
        accountId: target.id,
        status: 'disabled',
        expectedRevision: 0,
        actorAuthorization: {
          requiredRoleGroups: [['system.admin']],
        },
      }),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError)
    await expect(
      runtime.administrationRead.getAccount(target.id),
    ).resolves.toMatchObject({
      state: 'active',
      revision: 0,
    })
  })

  it('does not activate an invited account through the status endpoint', async () => {
    const [actor, target] = await runtime.provider.withClient((client) =>
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
      runtime.administrationMutation.changeStatus({
        actorId: actor.id,
        accountId: target.id,
        status: 'active',
        expectedRevision: 0,
        actorAuthorization: {
          requiredRoleGroups: [['system.admin']],
        },
      }),
    ).rejects.toBeInstanceOf(AuthStateConflictError)
    await expect(
      runtime.administrationRead.getAccount(target.id),
    ).resolves.toMatchObject({
      state: 'invited',
      revision: 0,
    })
  })

  it('allows exactly one concurrent mutation for one account revision', async () => {
    const [actor, target] = await runtime.provider.withClient((client) =>
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
      runtime.administrationMutation.changeStatus(mutation),
      runtime.administrationMutation.changeStatus(mutation),
    ])

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected')
      expect(rejected.reason).toBeInstanceOf(AccountRevisionConflictError)
    await expect(
      runtime.administrationRead.getAccount(target.id),
    ).resolves.toMatchObject({
      state: 'disabled',
      revision: 1,
    })
  })

  it('retires identity data while preserving product-owned foreign keys', async () => {
    const originalEmail = 'retire-and-reuse@example.com'
    const [actor, target] = await runtime.provider.withClient(
      async (client) => {
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
            invitationToken: {
              create: {
                tokenDigest: Buffer.alloc(32, 34).toString('base64url'),
                expiresAt: new Date('2026-08-08T00:00:00.000Z'),
                createdAt: new Date('2026-08-07T00:00:00.000Z'),
              },
            },
          },
        })
        const claimableTombstone = `retired+${target.id}@invalid.local`
        await client.user.create({
          data: {
            email: claimableTombstone,
            normalizedEmail: claimableTombstone,
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
      },
    )

    await expect(
      runtime.administrationMutation.retireAccount({
        actorId: actor.id,
        accountId: target.id,
        expectedRevision: 0,
        actorAuthorization: {
          requiredRoleGroups: [['system.admin']],
        },
      }),
    ).resolves.toBe(true)

    await runtime.provider.withClient(async (client) => {
      const retired = await client.user.findUniqueOrThrow({
        where: { id: target.id },
        include: {
          credential: true,
          roles: true,
          emailVerificationToken: true,
          passwordResetToken: true,
          invitationToken: true,
          createdApprovalRequests: true,
        },
      })
      expect(retired).toMatchObject({
        id: target.id,
        email: `retired:${target.id}`,
        normalizedEmail: `retired:${target.id}`,
        status: 'RETIRED',
        credential: null,
        roles: [],
        emailVerificationToken: null,
        passwordResetToken: null,
        invitationToken: null,
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
})
