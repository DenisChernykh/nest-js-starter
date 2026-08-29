import { Inject, Injectable } from '@nestjs/common'

import type { AccountActorAuthorization } from '../../../application/account-administration.port'
import { AccountSelfMutationForbiddenError } from '../../../application/account-administration.service'
import { AuthorizationDeniedError } from '../../../application/auth-errors'
import type {
  SelfServiceDeliveryTarget,
  SelfServiceTokenInput,
} from '../../../application/auth.types'
import type { InvitationPersistencePort } from '../../../application/invitation-persistence.port'
import { isNormalizedEmailUniqueConflict } from '../../../infrastructure/prisma-auth-unique-constraint'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

@Injectable()
export class PrismaInvitationAdapter implements InvitationPersistencePort {
  public constructor(
    @Inject(PrismaClientProvider)
    private readonly provider: PrismaClientProvider,
    @Inject(TRANSACTION_PORT)
    private readonly transaction: TransactionPort,
  ) {}

  public async createInvitation(
    input: {
      readonly email: string
      readonly normalizedEmail: string
      readonly roleKeys: readonly string[]
      readonly actorId: string
      readonly actorAuthorization: AccountActorAuthorization
    } & SelfServiceTokenInput,
  ): Promise<SelfServiceDeliveryTarget | undefined> {
    try {
      return await this.transaction.run(() =>
        this.provider.withClient(async (client) => {
          await lockUser(client, input.actorId)
          await assertActorAuthorized(
            client,
            input.actorId,
            input.actorAuthorization,
          )
          const user = await client.user.create({
            data: {
              email: input.email,
              normalizedEmail: input.normalizedEmail,
              status: 'INVITED',
              roles: { create: input.roleKeys.map((roleKey) => ({ roleKey })) },
              invitationToken: {
                create: {
                  tokenDigest: input.tokenDigest,
                  expiresAt: input.expiresAt,
                  createdAt: input.createdAt,
                },
              },
            },
            select: { id: true, email: true },
          })
          return { userId: user.id, email: user.email }
        }),
      )
    } catch (error: unknown) {
      if (isNormalizedEmailUniqueConflict(error)) return undefined
      throw error
    }
  }

  public async resendInvitation(input: {
    readonly actorId: string
    readonly accountId: string
    readonly actorAuthorization: AccountActorAuthorization
    readonly token: SelfServiceTokenInput
    readonly now: Date
  }): Promise<SelfServiceDeliveryTarget | undefined> {
    if (input.token.expiresAt <= input.now) return undefined
    assertDistinctAccountIds(input.actorId, input.accountId)
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        await lockUsers(client, [input.actorId, input.accountId])
        await assertActorAuthorized(
          client,
          input.actorId,
          input.actorAuthorization,
        )
        const user = await client.user.findUnique({
          where: { id: input.accountId },
          select: { id: true, email: true, status: true },
        })
        if (user === null || user.status !== 'INVITED') return undefined
        await client.accountInvitationToken.upsert({
          where: { userId: input.accountId },
          create: { userId: input.accountId, ...input.token },
          update: input.token,
        })
        return { userId: user.id, email: user.email }
      }),
    )
  }

  public async isInvitationTokenEligible(
    tokenDigest: string,
    now: Date,
  ): Promise<boolean> {
    const token = await this.provider.withClient((client) =>
      client.accountInvitationToken.findUnique({
        where: { tokenDigest },
        select: {
          expiresAt: true,
          user: {
            select: { status: true, credential: { select: { userId: true } } },
          },
        },
      }),
    )
    return (
      token !== null &&
      token.expiresAt > now &&
      token.user.status === 'INVITED' &&
      token.user.credential === null
    )
  }

  public async acceptInvitation(input: {
    readonly tokenDigest: string
    readonly passwordHash: string
    readonly now: Date
  }): Promise<boolean> {
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        const owner = await client.accountInvitationToken.findUnique({
          where: { tokenDigest: input.tokenDigest },
          select: { userId: true },
        })
        if (owner === null) return false
        await lockUser(client, owner.userId)
        const token = await client.accountInvitationToken.findUnique({
          where: { tokenDigest: input.tokenDigest },
          select: {
            userId: true,
            expiresAt: true,
            user: { select: { status: true } },
          },
        })
        if (
          token === null ||
          token.expiresAt <= input.now ||
          token.user.status !== 'INVITED'
        )
          return false
        const claimed = await client.accountInvitationToken.deleteMany({
          where: {
            userId: token.userId,
            tokenDigest: input.tokenDigest,
            expiresAt: { gt: input.now },
          },
        })
        if (claimed.count !== 1) return false
        await client.user.update({
          where: { id: token.userId },
          data: {
            status: 'ACTIVE',
            emailVerifiedAt: input.now,
            credential: { create: { passwordHash: input.passwordHash } },
            accountRevision: { increment: 1 },
          },
        })
        return true
      }),
    )
  }
}

function assertDistinctAccountIds(actorId: string, accountId: string): void {
  if (actorId.toLowerCase() === accountId.toLowerCase())
    throw new AccountSelfMutationForbiddenError()
}

async function assertActorAuthorized(
  client: Prisma.TransactionClient | PrismaClient,
  actorId: string,
  authorization: AccountActorAuthorization,
): Promise<void> {
  const actor = await client.user.findUnique({
    where: { id: actorId },
    select: {
      status: true,
      roles: { select: { roleKey: true } },
    },
  })
  const actorRoles = new Set(actor?.roles.map(({ roleKey }) => roleKey) ?? [])
  if (
    actor?.status !== 'ACTIVE' ||
    authorization.requiredRoleGroups.some(
      (roleKeys) => !roleKeys.some((roleKey) => actorRoles.has(roleKey)),
    )
  )
    throw new AuthorizationDeniedError()
}

async function lockUser(
  client: Prisma.TransactionClient | PrismaClient,
  userId: string,
): Promise<void> {
  await client.$queryRaw`
    SELECT id FROM users WHERE id = ${userId} FOR UPDATE
  `
}

async function lockUsers(
  client: Prisma.TransactionClient | PrismaClient,
  userIds: readonly string[],
): Promise<void> {
  for (const userId of [...new Set(userIds)].sort())
    await lockUser(client, userId)
}
