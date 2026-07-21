import { Inject, Injectable } from '@nestjs/common'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import type { DatabaseRuntimeConfig } from '@/platform/config/runtime-config.types'
import type { TransactionPort } from '@/shared/application/transaction.port'

import { PrismaClientProvider } from './prisma-client.provider'
import { PrismaTransactionContext } from './prisma-transaction.context'

/** Implements the framework-free application transaction boundary with Prisma. */
@Injectable()
export class PrismaTransactionAdapter implements TransactionPort {
  public constructor(
    private readonly provider: PrismaClientProvider,
    private readonly context: PrismaTransactionContext,
    @Inject(RuntimeConfigService)
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
