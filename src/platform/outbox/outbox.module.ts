import { Module, type DynamicModule } from '@nestjs/common'

import { DatabaseModule } from '@/platform/database/database.module'

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
        PrismaOutboxStore,
        TransactionalOutboxWriter,
        { provide: OUTBOX_STORE, useExisting: PrismaOutboxStore },
      ],
      exports: [TransactionalOutboxWriter, OUTBOX_STORE],
    }
  }
}
