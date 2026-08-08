import { Inject, Injectable } from '@nestjs/common'

import type { DatabaseRuntimeConfig } from '@/platform/config/runtime-config.types'
import type { TransactionPort } from '@/shared/application/transaction.port'

import { PrismaClientProvider } from './prisma-client.provider'
import { PrismaTransactionContext } from './prisma-transaction.context'
import { DATABASE_RUNTIME_CONFIG } from './database.tokens'

/** Implements the framework-free application transaction boundary with Prisma. */
@Injectable()
export class PrismaTransactionAdapter implements TransactionPort {
  public constructor(
    @Inject(PrismaClientProvider)
    private readonly provider: PrismaClientProvider,
    @Inject(PrismaTransactionContext)
    private readonly context: PrismaTransactionContext,
    @Inject(DATABASE_RUNTIME_CONFIG)
    private readonly config: { readonly database: DatabaseRuntimeConfig },
  ) {}

  /** Joins an active context or opens an interactive Prisma transaction. */
  public run<T>(operation: () => Promise<T>): Promise<T> {
    return this.provider.withClient((client) =>
      this.context.run(client, operation, {
        maxWait: this.config.database.transactionMaxWaitMs,
        timeout: this.config.database.transactionTimeoutMs,
      }),
    )
  }
}
