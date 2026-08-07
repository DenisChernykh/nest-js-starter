import { Inject, Injectable } from '@nestjs/common'

import {
  AuthPersistenceIntegrityError,
  type AuthPersistencePort,
} from '../application/auth-persistence.port'
import type {
  AccountAdministrationPort,
  AccountActorAuthorization,
  AccountAdministrationState,
  AdminAccount,
} from '../application/account-administration.port'
import {
  AccountEtagPreconditionFailedError,
  AccountSelfMutationForbiddenError,
} from '../application/account-administration.service'
import {
  AuthorizationDeniedError,
  AuthStateConflictError,
} from '../application/auth-errors'
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
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

const authProjectionInclude = {
  roles: { select: { roleKey: true } },
} as const

const adminAccountInclude = {
  roles: { select: { roleKey: true } },
} as const

type AdminAccountRow = Prisma.UserGetPayload<{
  include: typeof adminAccountInclude
}>

/** Prisma adapter for durable identity, credential and security-state data. */
@Injectable()
export class PrismaAuthRepository
  implements AuthPersistencePort, AccountAdministrationPort
{
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

  public async deletePasswordResetToken(userId: string): Promise<void> {
    await this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        await lockUser(client, userId)
        await client.passwordResetToken.deleteMany({ where: { userId } })
      }),
    )
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
          create: { userId: user.id, ...token },
          update: token,
        })
        return { userId: user.id, email: user.email }
      }),
    )
  }

  public async isPasswordResetTokenEligible(
    tokenDigest: string,
    now: Date,
  ): Promise<boolean> {
    const token = await this.provider.withClient((client) =>
      client.passwordResetToken.findUnique({
        where: { tokenDigest },
        select: {
          expiresAt: true,
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
    return (
      token !== null &&
      token.expiresAt > now &&
      token.user.status === 'ACTIVE' &&
      token.user.emailVerifiedAt !== null &&
      token.user.credential !== null
    )
  }

  public async confirmPasswordReset(
    input: ConfirmPasswordResetInput,
  ): Promise<SelfServiceDeliveryTarget | undefined> {
    return this.transaction.run(() =>
      this.provider.withClient(async (client) => {
        const tokenOwner = await client.passwordResetToken.findUnique({
          where: { tokenDigest: input.tokenDigest },
          select: { userId: true },
        })
        if (tokenOwner === null) return undefined
        await lockUser(client, tokenOwner.userId)
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
          data: {
            sessionGeneration: { increment: 1 },
            accountRevision: { increment: 1 },
          },
        })
        return { userId: token.user.id, email: token.user.email }
      }),
    )
  }

  public async listAccounts(input: {
    readonly page: number
    readonly pageSize: number
    readonly search?: string
    readonly state?: AccountAdministrationState
  }): Promise<{
    readonly items: readonly AdminAccount[]
    readonly total: number
  }> {
    const where = {
      ...(input.state === undefined
        ? {}
        : { status: accountStateToPrisma(input.state) }),
      ...(input.search === undefined || input.search.trim() === ''
        ? {}
        : {
            email: {
              contains: input.search.trim(),
              mode: 'insensitive' as const,
            },
          }),
    }
    const [items, total] = await this.provider.withClient((client) =>
      Promise.all([
        client.user.findMany({
          where,
          include: adminAccountInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        client.user.count({ where }),
      ]),
    )
    return { items: items.map(mapAdminAccount), total }
  }

  public async getAccount(
    accountId: string,
  ): Promise<AdminAccount | undefined> {
    const user = await this.provider.withClient((client) =>
      client.user.findUnique({
        where: { id: accountId },
        include: adminAccountInclude,
      }),
    )
    return user === null ? undefined : mapAdminAccount(user)
  }

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
            status: input.status === 'active' ? 'ACTIVE' : 'DISABLED',
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
        const tombstone = `retired+${input.accountId}@invalid.local`
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

function mapAdminAccount(row: AdminAccountRow): AdminAccount {
  return {
    id: row.id,
    email: row.status === 'RETIRED' ? null : row.email,
    state: row.status.toLowerCase() as AccountAdministrationState,
    emailVerifiedAt: row.emailVerifiedAt,
    roleKeys: row.roles.map(({ roleKey }) => roleKey).sort(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    retiredAt: row.retiredAt,
    revision: row.accountRevision,
  }
}

function accountStateToPrisma(
  state: AccountAdministrationState,
): 'INVITED' | 'ACTIVE' | 'DISABLED' | 'RETIRED' {
  return state.toUpperCase() as 'INVITED' | 'ACTIVE' | 'DISABLED' | 'RETIRED'
}

function assertAccountRevision(actual: number, expected: number): void {
  if (actual !== expected) throw new AccountEtagPreconditionFailedError()
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
