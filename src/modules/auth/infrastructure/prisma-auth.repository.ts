import { Injectable } from '@nestjs/common'

import {
  AuthPersistenceIntegrityError,
  type AuthPersistencePort,
} from '../application/auth-persistence.port'
import type {
  AuthProjection,
  CredentialSnapshot,
  InitialAdminInput,
  InitialAdminResult,
} from '../application/auth.types'
import { mapAuthProjection, mapCredentialSnapshot } from './prisma-auth.mapper'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import type { TransactionPort } from '@/shared/application/transaction.port'

const authProjectionInclude = {
  roles: { select: { roleKey: true } },
} as const

/** Prisma adapter for durable identity, credential and security-state data. */
@Injectable()
export class PrismaAuthRepository implements AuthPersistencePort {
  public constructor(
    private readonly provider: PrismaClientProvider,
    private readonly transaction: TransactionPort,
  ) {}

  public async findCredentialByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<CredentialSnapshot | undefined> {
    const row = await this.provider.withClient((client) =>
      client.user.findUnique({
        where: { normalizedEmail },
        include: {
          ...authProjectionInclude,
          credential: {
            select: { passwordHash: true, version: true },
          },
        },
      }),
    )
    return row === null ? undefined : mapCredentialSnapshot(row)
  }

  public async findAuthProjectionByUserId(
    userId: string,
  ): Promise<AuthProjection | undefined> {
    const row = await this.provider.withClient((client) =>
      client.user.findUnique({
        where: { id: userId },
        include: authProjectionInclude,
      }),
    )
    return row === null ? undefined : mapAuthProjection(row)
  }

  public async readGlobalSessionEpoch(): Promise<bigint> {
    const state = await this.provider.withClient((client) =>
      client.authSecurityState.findUnique({
        where: { id: 1 },
        select: { globalSessionEpoch: true },
      }),
    )
    if (state === null) throw new AuthPersistenceIntegrityError()
    return state.globalSessionEpoch
  }

  public async replacePasswordIfVersion(
    userId: string,
    expectedVersion: number,
    passwordHash: string,
  ): Promise<boolean> {
    const result = await this.provider.withClient((client) =>
      client.passwordCredential.updateMany({
        where: { userId, version: expectedVersion },
        data: { passwordHash, version: { increment: 1 } },
      }),
    )
    return result.count === 1
  }

  public async incrementSessionGeneration(userId: string): Promise<bigint> {
    const user = await this.provider.withClient((client) =>
      client.user.update({
        where: { id: userId },
        data: { sessionGeneration: { increment: 1 } },
        select: { sessionGeneration: true },
      }),
    )
    return user.sessionGeneration
  }

  public bootstrapInitialAdmin(
    input: InitialAdminInput,
  ): Promise<InitialAdminResult> {
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        await client.$queryRawUnsafe(
          'SELECT id FROM auth_security_state WHERE id = 1 FOR UPDATE',
        )
        const state = await client.authSecurityState.findUnique({
          where: { id: 1 },
          select: { adminBootstrapCompletedAt: true },
        })
        if (state === null) throw new AuthPersistenceIntegrityError()
        if (state.adminBootstrapCompletedAt !== null) return { created: false }

        const user = await client.user.create({
          data: {
            email: input.email,
            normalizedEmail: input.normalizedEmail,
            credential: { create: { passwordHash: input.passwordHash } },
            roles: { create: { roleKey: 'system.admin' } },
          },
          select: { id: true },
        })
        await client.authSecurityState.update({
          where: { id: 1 },
          data: { adminBootstrapCompletedAt: new Date() },
        })
        return { created: true, userId: user.id }
      }),
    )
  }
}
