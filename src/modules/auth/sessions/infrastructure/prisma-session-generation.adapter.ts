import { Inject, Injectable } from '@nestjs/common'

import type { SessionGenerationPort } from '../../application/session-generation.port'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

@Injectable()
export class PrismaSessionGenerationAdapter implements SessionGenerationPort {
  public constructor(
    @Inject(PrismaClientProvider)
    private readonly provider: PrismaClientProvider,
    @Inject(TRANSACTION_PORT)
    private readonly transaction: TransactionPort,
  ) {}

  public async incrementSessionGeneration(userId: string): Promise<bigint> {
    const user = await this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        await lockUser(client, userId)
        return client.user.update({
          where: { id: userId },
          data: {
            sessionGeneration: { increment: 1 },
            accountRevision: { increment: 1 },
          },
          select: { sessionGeneration: true },
        })
      }),
    )
    return user.sessionGeneration
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
