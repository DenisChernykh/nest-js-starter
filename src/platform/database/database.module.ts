import { Module, type DynamicModule } from '@nestjs/common'

import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { TRANSACTION_PORT } from '@/shared/application/transaction.port'
import type { DatabaseRuntimeConfig } from '@/platform/config/runtime-config.types'

import {
  DATABASE_LIFECYCLE,
  DATABASE_READINESS_PROBE,
  DATABASE_RUNTIME_CONFIG,
} from './database.tokens'
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
    {
      provide: DATABASE_RUNTIME_CONFIG,
      inject: [RuntimeConfigService],
      useFactory: (
        config: RuntimeConfigService,
      ): { readonly database: DatabaseRuntimeConfig } =>
        Object.freeze({ database: config.database }),
    },
    PrismaClientProvider,
    PrismaDatabaseLifecycle,
    PrismaTransactionContext,
    PrismaTransactionAdapter,
    {
      provide: PostgresReadinessProbe,
      inject: [PrismaClientProvider, DATABASE_RUNTIME_CONFIG],
      useFactory: (
        provider: PrismaClientProvider,
        config: { readonly database: DatabaseRuntimeConfig },
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
    PrismaTransactionContext,
    DATABASE_LIFECYCLE,
    DATABASE_READINESS_PROBE,
    TRANSACTION_PORT,
  ],
})
export class DatabaseModule {
  public static forRoot(config: DatabaseRuntimeConfig): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATABASE_RUNTIME_CONFIG,
          useValue: Object.freeze({ database: config }),
        },
      ],
    }
  }
}
