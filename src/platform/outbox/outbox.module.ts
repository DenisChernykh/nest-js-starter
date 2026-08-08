import { Module, type DynamicModule } from '@nestjs/common'

import { DatabaseModule } from '@/platform/database/database.module'
import type { DatabaseRuntimeConfig } from '@/platform/config/runtime-config.types'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'

import { PrismaOutboxStore } from './prisma-outbox.store'
import { OUTBOX_STORE } from './outbox.ports'
import { TransactionalOutboxWriter } from './transactional-outbox.writer'

@Module({})
export class OutboxModule {
  public static forWriter(): DynamicModule {
    return {
      module: OutboxModule,
      imports: [DatabaseModule],
      providers: [
        {
          provide: TransactionalOutboxWriter,
          inject: [PrismaClientProvider, PrismaTransactionContext],
          useFactory: (
            provider: PrismaClientProvider,
            context: PrismaTransactionContext,
          ): TransactionalOutboxWriter =>
            new TransactionalOutboxWriter(provider, context),
        },
      ],
      exports: [TransactionalOutboxWriter],
    }
  }

  public static forRelay(
    databaseConfig?: DatabaseRuntimeConfig,
  ): DynamicModule {
    return {
      module: OutboxModule,
      imports: [
        databaseConfig === undefined
          ? DatabaseModule
          : DatabaseModule.forRoot(databaseConfig),
      ],
      providers: [
        {
          provide: PrismaOutboxStore,
          inject: [PrismaClientProvider],
          useFactory: (provider: PrismaClientProvider): PrismaOutboxStore =>
            new PrismaOutboxStore(provider),
        },
        { provide: OUTBOX_STORE, useExisting: PrismaOutboxStore },
      ],
      exports: [OUTBOX_STORE],
    }
  }
}
