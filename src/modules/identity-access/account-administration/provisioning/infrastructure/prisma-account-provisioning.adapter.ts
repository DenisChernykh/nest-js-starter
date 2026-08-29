import { Inject, Injectable } from '@nestjs/common'

import {
  AccountProvisioningIntegrityError,
  type AccountProvisioningPort,
  type CreateUserResult,
  type InitialAdminInput,
  type InitialAdminResult,
  type UserProvisioningInput,
} from '../application/account-provisioning.port'
import { isNormalizedEmailUniqueConflict } from './prisma-normalized-email-conflict'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

@Injectable()
export class PrismaAccountProvisioningAdapter implements AccountProvisioningPort {
  public constructor(
    @Inject(PrismaClientProvider)
    private readonly provider: PrismaClientProvider,
    @Inject(TRANSACTION_PORT)
    private readonly transaction: TransactionPort,
  ) {}

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
        if (state === null) throw new AccountProvisioningIntegrityError()
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
      if (isNormalizedEmailUniqueConflict(error)) return { created: false }
      throw error
    }
  }
}
