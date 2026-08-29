import { Inject, Injectable } from '@nestjs/common'

import type {
  SelfServiceRegistrationInput,
  SelfServiceRegistrationResult,
} from '../../../application/auth.types'
import type { RegistrationPersistencePort } from '../../../application/registration-persistence.port'
import { isNormalizedEmailUniqueConflict } from '../../../infrastructure/prisma-auth-unique-constraint'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'

@Injectable()
export class PrismaRegistrationAdapter implements RegistrationPersistencePort {
  public constructor(
    @Inject(PrismaClientProvider)
    private readonly provider: PrismaClientProvider,
    @Inject(TRANSACTION_PORT)
    private readonly transaction: TransactionPort,
  ) {}

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
      if (isNormalizedEmailUniqueConflict(error)) return { created: false }
      throw error
    }
  }
}
