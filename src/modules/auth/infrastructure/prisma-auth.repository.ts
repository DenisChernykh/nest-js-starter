import { Inject, Injectable } from '@nestjs/common'

import {
  AuthPersistenceIntegrityError,
  type AuthPersistencePort,
} from '../application/auth-persistence.port'
import type {
  AuthProjection,
  CreateUserResult,
  CredentialSnapshot,
  InitialAdminInput,
  InitialAdminResult,
  UserProvisioningInput,
  ConfirmPasswordResetInput,
  SelfServiceDeliveryTarget,
  SelfServiceRegistrationInput,
  SelfServiceRegistrationResult,
  SelfServiceTokenInput,
} from '../application/auth.types'
import { mapAuthProjection, mapCredentialSnapshot } from './prisma-auth.mapper'
import { Prisma } from '@/generated/prisma/client'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

const authProjectionInclude = {
  roles: { select: { roleKey: true } },
} as const

/** Prisma adapter for durable identity, credential and security-state data. */
@Injectable()
export class PrismaAuthRepository implements AuthPersistencePort {
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
            emailVerifiedAt: input.emailVerifiedAt,
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

  /** Atomically creates one user with its credential and role assignments. */
  public async createUser(
    input: UserProvisioningInput,
  ): Promise<CreateUserResult> {
    try {
      return await this.transaction.run(() =>
        this.provider.withClient(async (client) => {
          const user = await client.user.create({
            data: {
              email: input.email,
              normalizedEmail: input.normalizedEmail,
              emailVerifiedAt: input.emailVerifiedAt,
              credential: { create: { passwordHash: input.passwordHash } },
              roles: {
                create: input.roleKeys.map((roleKey) => ({ roleKey })),
              },
            },
            select: { id: true },
          })
          return { created: true, userId: user.id }
        }),
      )
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { created: false }
      }
      throw error
    }
  }

  public async registerSelfServiceUser(
    input: SelfServiceRegistrationInput,
  ): Promise<SelfServiceRegistrationResult> {
    try {
      return await this.transaction.run(() =>
        this.provider.withClient(async (client) => {
          const user = await client.user.create({
            data: {
              email: input.email,
              normalizedEmail: input.normalizedEmail,
              emailVerifiedAt: null,
              credential: { create: { passwordHash: input.passwordHash } },
              emailVerificationToken: {
                create: {
                  tokenDigest: input.tokenDigest,
                  expiresAt: input.expiresAt,
                  createdAt: input.createdAt,
                },
              },
            },
            select: { id: true, email: true },
          })
          return { created: true, userId: user.id, email: user.email }
        }),
      )
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { created: false }
      }
      throw error
    }
  }

  public async rotateEmailVerificationToken(
    normalizedEmail: string,
    token: SelfServiceTokenInput,
    _now: Date,
  ): Promise<SelfServiceDeliveryTarget | undefined> {
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
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
          data: { emailVerifiedAt: now },
        })
        if (updated.count !== 1) return undefined
        return { userId: token.user.id, email: token.user.email }
      }),
    )
  }

  public async rotatePasswordResetToken(
    normalizedEmail: string,
    token: SelfServiceTokenInput,
    _now: Date,
  ): Promise<SelfServiceDeliveryTarget | undefined> {
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
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
          create: { userId: user.id, ...token },
          update: token,
        })
        return { userId: user.id, email: user.email }
      }),
    )
  }

  public async confirmPasswordReset(
    input: ConfirmPasswordResetInput,
  ): Promise<SelfServiceDeliveryTarget | undefined> {
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        const token = await client.passwordResetToken.findUnique({
          where: { tokenDigest: input.tokenDigest },
          select: {
            userId: true,
            expiresAt: true,
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
          },
        })
        if (claimed.count !== 1) return undefined
        await client.passwordCredential.update({
          where: { userId: token.userId },
          data: { passwordHash: input.passwordHash, version: { increment: 1 } },
        })
        await client.user.update({
          where: { id: token.userId },
          data: { sessionGeneration: { increment: 1 } },
        })
        return { userId: token.user.id, email: token.user.email }
      }),
    )
  }
}
