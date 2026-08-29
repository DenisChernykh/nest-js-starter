import { Inject, Injectable } from '@nestjs/common'

import type { AccountActorAuthorization } from '../../../application/account-administration.port'
import { AccountSelfMutationForbiddenError } from '../../../application/account-administration.service'
import { AuthorizationDeniedError } from '../../../application/auth-errors'
import type {
  ConfirmPasswordResetInput,
  PasswordResetTokenSource,
  SelfServiceDeliveryTarget,
  SelfServiceTokenInput,
} from '../../../application/auth.types'
import type { PasswordRecoveryPersistencePort } from '../../../application/password-recovery-persistence.port'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

@Injectable()
export class PrismaPasswordRecoveryAdapter implements PasswordRecoveryPersistencePort {
  public constructor(
    @Inject(PrismaClientProvider)
    private readonly provider: PrismaClientProvider,
    @Inject(TRANSACTION_PORT)
    private readonly transaction: TransactionPort,
  ) {}

  public async rotatePasswordResetToken(
    normalizedEmail: string,
    token: SelfServiceTokenInput,
    now: Date,
  ): Promise<SelfServiceDeliveryTarget | undefined> {
    if (token.expiresAt <= now) return undefined
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        const lockedUser = await client.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM users WHERE normalized_email = ${normalizedEmail} FOR UPDATE
        `
        if (lockedUser[0] === undefined) return undefined
        const user = await client.user.findUnique({
          where: { normalizedEmail },
          select: {
            id: true,
            email: true,
            status: true,
            emailVerifiedAt: true,
            credential: { select: { userId: true } },
          },
        })
        if (
          user === null ||
          user.status !== 'ACTIVE' ||
          user.emailVerifiedAt === null ||
          user.credential === null
        ) {
          return undefined
        }
        await client.passwordResetToken.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...token, source: 'SELF_SERVICE' },
          update: { ...token, source: 'SELF_SERVICE' },
        })
        return { userId: user.id, email: user.email }
      }),
    )
  }

  public async getEligiblePasswordResetTokenSource(
    tokenDigest: string,
    now: Date,
  ): Promise<PasswordResetTokenSource | undefined> {
    const token = await this.provider.withClient((client) =>
      client.passwordResetToken.findUnique({
        where: { tokenDigest },
        select: {
          expiresAt: true,
          source: true,
          user: {
            select: {
              status: true,
              emailVerifiedAt: true,
              credential: { select: { userId: true } },
            },
          },
        },
      }),
    )
    if (
      token === null ||
      token.expiresAt <= now ||
      token.user.status !== 'ACTIVE' ||
      token.user.emailVerifiedAt === null ||
      token.user.credential === null
    )
      return undefined
    return token.source === 'SELF_SERVICE' ? 'self-service' : 'administrator'
  }

  public async confirmPasswordReset(
    input: ConfirmPasswordResetInput,
  ): Promise<SelfServiceDeliveryTarget | undefined> {
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        const tokenOwner = await client.passwordResetToken.findUnique({
          where: { tokenDigest: input.tokenDigest },
          select: { userId: true, source: true },
        })
        if (
          tokenOwner === null ||
          tokenOwner.source !== passwordResetSourceToPrisma(input.source)
        )
          return undefined
        await lockUser(client, tokenOwner.userId)
        const token = await client.passwordResetToken.findUnique({
          where: { tokenDigest: input.tokenDigest },
          select: {
            userId: true,
            expiresAt: true,
            source: true,
            user: {
              select: {
                id: true,
                email: true,
                status: true,
                emailVerifiedAt: true,
                credential: { select: { userId: true } },
              },
            },
          },
        })
        if (
          token === null ||
          token.source !== passwordResetSourceToPrisma(input.source) ||
          token.expiresAt <= input.now ||
          token.user.status !== 'ACTIVE' ||
          token.user.emailVerifiedAt === null ||
          token.user.credential === null
        ) {
          return undefined
        }
        const claimed = await client.passwordResetToken.deleteMany({
          where: {
            userId: token.userId,
            tokenDigest: input.tokenDigest,
            expiresAt: { gt: input.now },
            source: passwordResetSourceToPrisma(input.source),
          },
        })
        if (claimed.count !== 1) return undefined
        await client.passwordCredential.update({
          where: { userId: token.userId },
          data: { passwordHash: input.passwordHash, version: { increment: 1 } },
        })
        await client.user.update({
          where: { id: token.userId },
          data: {
            sessionGeneration: { increment: 1 },
            accountRevision: { increment: 1 },
          },
        })
        return { userId: token.user.id, email: token.user.email }
      }),
    )
  }

  public async rotateAdministratorPasswordReset(input: {
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
          select: {
            id: true,
            email: true,
            status: true,
            emailVerifiedAt: true,
            credential: { select: { userId: true } },
          },
        })
        if (
          user === null ||
          user.status !== 'ACTIVE' ||
          user.emailVerifiedAt === null ||
          user.credential === null
        )
          return undefined
        await client.passwordResetToken.upsert({
          where: { userId: input.accountId },
          create: {
            userId: input.accountId,
            ...input.token,
            source: 'ADMINISTRATOR',
          },
          update: { ...input.token, source: 'ADMINISTRATOR' },
        })
        return { userId: user.id, email: user.email }
      }),
    )
  }
}

function passwordResetSourceToPrisma(
  source: PasswordResetTokenSource,
): 'SELF_SERVICE' | 'ADMINISTRATOR' {
  return source === 'self-service' ? 'SELF_SERVICE' : 'ADMINISTRATOR'
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
