import { Inject, Injectable } from '@nestjs/common'

import type {
  ChangePasswordAndInvalidateInput,
  PasswordCredentialPort,
} from '../application/password-credential.port'
import type { CredentialSnapshot } from '../application/password-credential.port'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

const credentialSnapshotSelect = {
  id: true,
  status: true,
  emailVerifiedAt: true,
  credential: {
    select: { passwordHash: true, version: true },
  },
} as const

interface CredentialSnapshotRow {
  readonly id: string
  readonly status: 'INVITED' | 'ACTIVE' | 'DISABLED' | 'RETIRED'
  readonly emailVerifiedAt: Date | null
  readonly credential: {
    readonly passwordHash: string
    readonly version: number
  } | null
}

@Injectable()
export class PrismaPasswordCredentialAdapter implements PasswordCredentialPort {
  public constructor(
    @Inject(PrismaClientProvider)
    private readonly provider: PrismaClientProvider,
    @Inject(TRANSACTION_PORT)
    private readonly transaction: TransactionPort,
  ) {}

  public async findCredentialByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<CredentialSnapshot | undefined> {
    const row = await this.provider.withClient((client) =>
      client.user.findUnique({
        where: { normalizedEmail },
        select: credentialSnapshotSelect,
      }),
    )
    return row === null ? undefined : mapCredentialSnapshot(row)
  }

  public async findCredentialByUserId(
    userId: string,
  ): Promise<CredentialSnapshot | undefined> {
    const row = await this.provider.withClient((client) =>
      client.user.findUnique({
        where: { id: userId },
        select: credentialSnapshotSelect,
      }),
    )
    return row === null ? undefined : mapCredentialSnapshot(row)
  }

  public async replacePasswordIfVersion(
    userId: string,
    expectedVersion: number,
    passwordHash: string,
  ): Promise<boolean> {
    const result = await this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        await lockUser(client, userId)
        return client.passwordCredential.updateMany({
          where: { userId, version: expectedVersion },
          data: { passwordHash, version: { increment: 1 } },
        })
      }),
    )
    return result.count === 1
  }

  public changePasswordAndInvalidate(
    input: ChangePasswordAndInvalidateInput,
  ): Promise<boolean> {
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        await lockUser(client, input.userId)
        const replaced = await client.passwordCredential.updateMany({
          where: {
            userId: input.userId,
            version: input.expectedVersion,
          },
          data: {
            passwordHash: input.passwordHash,
            version: { increment: 1 },
          },
        })
        if (replaced.count !== 1) return false
        await client.passwordResetToken.deleteMany({
          where: { userId: input.userId },
        })
        await client.user.update({
          where: { id: input.userId },
          data: {
            sessionGeneration: { increment: 1 },
            accountRevision: { increment: 1 },
          },
        })
        return true
      }),
    )
  }
}

function mapCredentialSnapshot(
  row: CredentialSnapshotRow,
): CredentialSnapshot | undefined {
  if (row.credential === null) return undefined
  return Object.freeze({
    userId: row.id,
    status: row.status === 'ACTIVE' ? 'active' : 'disabled',
    emailVerifiedAt: row.emailVerifiedAt ?? undefined,
    passwordHash: row.credential.passwordHash,
    passwordVersion: row.credential.version,
  })
}

async function lockUser(
  client: Prisma.TransactionClient | PrismaClient,
  userId: string,
): Promise<void> {
  await client.$queryRaw`
    SELECT id FROM users WHERE id = ${userId} FOR UPDATE
  `
}
