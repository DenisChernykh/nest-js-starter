import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'

import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { DatabaseModule } from '@/platform/database/database.module'
import { HealthModule } from '@/platform/http/health/health.module'
import { RequestOperationInterceptor } from '@/platform/http/bootstrap/request-operation.interceptor'
import { LifecycleModule } from '@/platform/lifecycle/lifecycle.module'

/**
 * Определяет composition root API process без прямых driver imports.
 */
@Module({
  imports: [RuntimeConfigModule, DatabaseModule, LifecycleModule, HealthModule],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestOperationInterceptor,
    },
  ],
})
export class ApiModule {}
