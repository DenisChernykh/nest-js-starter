import { Module, type DynamicModule } from '@nestjs/common'

import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import type { ApplicationRuntimeConfig } from '@/platform/config/runtime-config.types'
import { DatabaseModule } from '@/platform/database/database.module'
import { HealthModule } from '@/platform/http/health/health.module'
import { LifecycleModule } from '@/platform/lifecycle/lifecycle.module'
import { AuthModule } from '@/modules/auth/composition/auth.module'
import { RedisModule } from '@/platform/redis/redis.module'
import { LoggingModule } from '@/platform/logging/logging.module'
import { HttpErrorsModule } from '@/platform/http/errors/http-errors.module'

import { API_HTTP_PROBLEM_CONTRIBUTIONS } from './api-http-problems'

/**
 * Определяет composition root API process без прямых driver imports.
 */
@Module({})
export class ApiModule {
  /**
   * Composes the API graph around one already validated runtime config.
   *
   * @param config - Immutable API process configuration.
   * @returns Dynamic API root with global typed config registration.
   */
  public static forRoot(config: ApplicationRuntimeConfig): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        RuntimeConfigModule.forRoot(config),
        LoggingModule.forRoot(),
        DatabaseModule,
        RedisModule,
        LifecycleModule,
        HealthModule,
        HttpErrorsModule.forRoot(API_HTTP_PROBLEM_CONTRIBUTIONS),
        AuthModule,
      ],
      providers: [],
    }
  }
}
