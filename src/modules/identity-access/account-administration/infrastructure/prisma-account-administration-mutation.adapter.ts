import { Inject, Injectable } from '@nestjs/common'

import type { AccountAdministrationMutationPort } from '../application/account-administration-mutation.port'
import type { AccountActorAuthorization } from '../../authorization/application/account-actor-authorization'
import { canonicalizeUserId } from '../../public-contracts/canonical-user-id'
import {
  AccountRevisionConflictError,
  AccountSelfMutationForbiddenError,
} from '../application/account-administration.errors'
import type { AdminAccount } from '../application/account-administration.model'
import {
  AuthorizationDeniedError,
  AuthStateConflictError,
} from '../../public-contracts/auth-errors'
import {
  adminAccountInclude,
  mapAdminAccount,
} from './prisma-account-administration.mapper'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

@Injectable()
export class PrismaAccountAdministrationMutationAdapter implements AccountAdministrationMutationPort {
  public constructor(
    @Inject(PrismaClientProvider)
    private readonly provider: PrismaClientProvider,
    @Inject(TRANSACTION_PORT)
    private readonly transaction: TransactionPort,
  ) {}

  public async changeStatus(input: {
    readonly actorId: string
    readonly accountId: string
    readonly status: 'active' | 'disabled'
    readonly expectedRevision: number
    readonly actorAuthorization: AccountActorAuthorization
  }): Promise<AdminAccount | undefined> {
    assertDistinctAccountIds(input.actorId, input.accountId)
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        await lockUsers(client, [input.actorId, input.accountId])
        await assertActorAuthorized(
          client,
          input.actorId,
          input.actorAuthorization,
        )
        const account = await client.user.findUnique({
          where: { id: input.accountId },
          include: adminAccountInclude,
        })
        if (account === null || account.status === 'RETIRED') return undefined
        assertAccountRevision(account.accountRevision, input.expectedRevision)
        const requestedStatus =
          input.status === 'active' ? 'ACTIVE' : 'DISABLED'
        if (
          !['ACTIVE', 'DISABLED'].includes(account.status) ||
          account.status === requestedStatus
        )
          throw new AuthStateConflictError()
        const disabling = input.status === 'disabled'
        const updated = await client.user.update({
          where: { id: input.accountId },
          data: {
            status: requestedStatus,
            accountRevision: { increment: 1 },
            ...(disabling ? { sessionGeneration: { increment: 1 } } : {}),
          },
          include: adminAccountInclude,
        })
        if (disabling) {
          await client.passwordResetToken.deleteMany({
            where: { userId: input.accountId },
          })
          await client.emailVerificationToken.deleteMany({
            where: { userId: input.accountId },
          })
          await client.accountInvitationToken.deleteMany({
            where: { userId: input.accountId },
          })
        }
        return mapAdminAccount(updated)
      }),
    )
  }

  public async replaceRoles(input: {
    readonly actorId: string
    readonly accountId: string
    readonly roleKeys: readonly string[]
    readonly expectedRevision: number
    readonly actorAuthorization: AccountActorAuthorization
  }): Promise<AdminAccount | undefined> {
    assertDistinctAccountIds(input.actorId, input.accountId)
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        await lockUsers(client, [input.actorId, input.accountId])
        await assertActorAuthorized(
          client,
          input.actorId,
          input.actorAuthorization,
        )
        const account = await client.user.findUnique({
          where: { id: input.accountId },
          include: adminAccountInclude,
        })
        if (account === null || account.status === 'RETIRED') return undefined
        assertAccountRevision(account.accountRevision, input.expectedRevision)
        await client.userRole.deleteMany({ where: { userId: input.accountId } })
        const updated = await client.user.update({
          where: { id: input.accountId },
          data: {
            accountRevision: { increment: 1 },
            roles: {
              create: input.roleKeys.map((roleKey) => ({ roleKey })),
            },
          },
          include: adminAccountInclude,
        })
        return mapAdminAccount(updated)
      }),
    )
  }

  public async retireAccount(input: {
    readonly actorId: string
    readonly accountId: string
    readonly expectedRevision: number
    readonly actorAuthorization: AccountActorAuthorization
  }): Promise<boolean> {
    assertDistinctAccountIds(input.actorId, input.accountId)
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        await lockUsers(client, [input.actorId, input.accountId])
        await assertActorAuthorized(
          client,
          input.actorId,
          input.actorAuthorization,
        )
        const account = await client.user.findUnique({
          where: { id: input.accountId },
          select: { accountRevision: true, status: true },
        })
        if (account === null || account.status === 'RETIRED') return false
        assertAccountRevision(account.accountRevision, input.expectedRevision)
        await client.passwordCredential.deleteMany({
          where: { userId: input.accountId },
        })
        await client.userRole.deleteMany({ where: { userId: input.accountId } })
        await client.emailVerificationToken.deleteMany({
          where: { userId: input.accountId },
        })
        await client.passwordResetToken.deleteMany({
          where: { userId: input.accountId },
        })
        await client.accountInvitationToken.deleteMany({
          where: { userId: input.accountId },
        })
        const tombstone = `retired:${input.accountId}`
        await client.user.update({
          where: { id: input.accountId },
          data: {
            email: tombstone,
            normalizedEmail: tombstone,
            emailVerifiedAt: null,
            status: 'RETIRED',
            retiredAt: new Date(),
            accountRevision: { increment: 1 },
            sessionGeneration: { increment: 1 },
          },
        })
        return true
      }),
    )
  }

  public async revokeAllSessions(input: {
    readonly actorId: string
    readonly accountId: string
    readonly actorAuthorization: AccountActorAuthorization
  }): Promise<boolean> {
    assertDistinctAccountIds(input.actorId, input.accountId)
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        await lockUsers(client, [input.actorId, input.accountId])
        await assertActorAuthorized(
          client,
          input.actorId,
          input.actorAuthorization,
        )
        const updated = await client.user.updateMany({
          where: { id: input.accountId, status: { not: 'RETIRED' } },
          data: {
            sessionGeneration: { increment: 1 },
            accountRevision: { increment: 1 },
          },
        })
        return updated.count === 1
      }),
    )
  }
}

function assertAccountRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new AccountRevisionConflictError()
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
    select: { status: true, roles: { select: { roleKey: true } } },
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
  await client.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
}

async function lockUsers(
  client: Prisma.TransactionClient | PrismaClient,
  userIds: readonly string[],
): Promise<void> {
  for (const userId of [
    ...new Set(userIds.map((userId) => canonicalizeUserId(userId))),
  ].sort())
    await lockUser(client, userId)
}
