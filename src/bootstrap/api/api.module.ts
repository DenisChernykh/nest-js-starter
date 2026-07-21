import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'

import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { DatabaseModule } from '@/platform/database/database.module'
import { HealthModule } from '@/platform/http/health/health.module'
import { RequestOperationInterceptor } from '@/platform/http/bootstrap/request-operation.interceptor'
import { LifecycleModule } from '@/platform/lifecycle/lifecycle.module'
import { AuthModule } from '@/modules/auth/composition/auth.module'
import { RedisModule } from '@/platform/redis/redis.module'

/**
 * Определяет composition root API process без прямых driver imports.
 */
@Module({
  imports: [
    RuntimeConfigModule,
    DatabaseModule,
    RedisModule,
    LifecycleModule,
    HealthModule,
    AuthModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestOperationInterceptor,
    },
  ],
})
export class ApiModule {}
