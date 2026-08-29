import { Inject, Injectable } from '@nestjs/common'

import type {
  SelfServiceDeliveryTarget,
  SelfServiceTokenInput,
} from '../../../application/auth.types'
import type { EmailVerificationPersistencePort } from '../../../application/email-verification-persistence.port'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

@Injectable()
export class PrismaEmailVerificationAdapter implements EmailVerificationPersistencePort {
  public constructor(
    @Inject(PrismaClientProvider)
    private readonly provider: PrismaClientProvider,
    @Inject(TRANSACTION_PORT)
    private readonly transaction: TransactionPort,
  ) {}

  public async rotateEmailVerificationToken(
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
          },
        })
        if (
          user === null ||
          user.status !== 'ACTIVE' ||
          user.emailVerifiedAt !== null
        ) {
          return undefined
        }
        await client.emailVerificationToken.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...token },
          update: token,
        })
        return { userId: user.id, email: user.email }
      }),
    )
  }

  public async confirmEmailVerification(
    tokenDigest: string,
    now: Date,
  ): Promise<SelfServiceDeliveryTarget | undefined> {
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        const tokenOwner = await client.emailVerificationToken.findUnique({
          where: { tokenDigest },
          select: { userId: true },
        })
        if (tokenOwner === null) return undefined
        await lockUser(client, tokenOwner.userId)
        const token = await client.emailVerificationToken.findUnique({
          where: { tokenDigest },
          select: {
            userId: true,
            expiresAt: true,
            user: {
              select: {
                id: true,
                email: true,
                status: true,
                emailVerifiedAt: true,
              },
            },
          },
        })
        if (
          token === null ||
          token.expiresAt <= now ||
          token.user.status !== 'ACTIVE' ||
          token.user.emailVerifiedAt !== null
        ) {
          return undefined
        }
        const claimed = await client.emailVerificationToken.deleteMany({
          where: { userId: token.userId, tokenDigest },
        })
        if (claimed.count !== 1) return undefined
        const updated = await client.user.updateMany({
          where: { id: token.userId, status: 'ACTIVE', emailVerifiedAt: null },
          data: {
            emailVerifiedAt: now,
            accountRevision: { increment: 1 },
          },
        })
        if (updated.count !== 1) return undefined
        return { userId: token.user.id, email: token.user.email }
      }),
    )
  }
}

async function lockUser(
  client: Prisma.TransactionClient | PrismaClient,
  userId: string,
): Promise<void> {
  await client.$queryRaw`
    SELECT id FROM users WHERE id = ${userId} FOR UPDATE
  `
}
