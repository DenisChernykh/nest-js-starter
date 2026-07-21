import { Module } from '@nestjs/common'

import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { TRANSACTION_PORT } from '@/shared/application/transaction.port'

import { DATABASE_LIFECYCLE, DATABASE_READINESS_PROBE } from './database.tokens'
import { PostgresReadinessProbe } from './postgres-readiness.probe'
import { PrismaClientProvider } from './prisma-client.provider'
import { PrismaDatabaseLifecycle } from './prisma-database.lifecycle'
import { PrismaTransactionAdapter } from './prisma-transaction.adapter'
import { PrismaTransactionContext } from './prisma-transaction.context'

/**
 * Explicit Nest composition boundary for PostgreSQL lifecycle and readiness.
 */
@Module({
  imports: [RuntimeConfigModule],
  providers: [
    PrismaClientProvider,
    PrismaDatabaseLifecycle,
    PrismaTransactionContext,
    PrismaTransactionAdapter,
    {
      provide: PostgresReadinessProbe,
      inject: [PrismaClientProvider, RuntimeConfigService],
      useFactory: (
        provider: PrismaClientProvider,
        config: RuntimeConfigService,
      ): PostgresReadinessProbe =>
        new PostgresReadinessProbe(provider, config.database.healthTimeoutMs),
    },
    {
      provide: DATABASE_LIFECYCLE,
      useExisting: PrismaDatabaseLifecycle,
    },
    {
      provide: DATABASE_READINESS_PROBE,
      useExisting: PostgresReadinessProbe,
    },
    {
      provide: TRANSACTION_PORT,
      useExisting: PrismaTransactionAdapter,
    },
  ],
  exports: [
    PrismaClientProvider,
    DATABASE_LIFECYCLE,
    DATABASE_READINESS_PROBE,
    TRANSACTION_PORT,
  ],
})
export class DatabaseModule {}
