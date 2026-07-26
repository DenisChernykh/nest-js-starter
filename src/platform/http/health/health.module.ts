import { Module } from '@nestjs/common'

import { DatabaseModule } from '@/platform/database/database.module'
import { DATABASE_READINESS_PROBE } from '@/platform/database/database.tokens'
import { LifecycleModule } from '@/platform/lifecycle/lifecycle.module'
import { RedisModule } from '@/platform/redis/redis.module'
import { REDIS_READINESS_INDICATOR } from '@/platform/redis/redis.tokens'
import type { DatabaseReadinessProbe } from '@/platform/database/database.contracts'
import type { RedisReadinessIndicator } from '@/platform/redis/redis-readiness.indicator'

import { HealthController } from './health.controller'
import { HealthRegistry } from './health-registry'
import { HealthService } from './health.service'
import { ActiveRequestTracker } from '@/platform/http/bootstrap/active-request-tracker'

/** Composes lifecycle-aware health checks from the fixed database and Redis probes. */
@Module({
  imports: [LifecycleModule, DatabaseModule, RedisModule],
  controllers: [HealthController],
  providers: [
    {
      provide: HealthRegistry,
      inject: [DATABASE_READINESS_PROBE, REDIS_READINESS_INDICATOR],
      useFactory: (
        database: DatabaseReadinessProbe,
        redis: RedisReadinessIndicator,
      ): HealthRegistry => new HealthRegistry([database, redis]),
    },
    HealthService,
    ActiveRequestTracker,
  ],
  exports: [
    LifecycleModule,
    HealthRegistry,
    HealthService,
    ActiveRequestTracker,
  ],
})
export class HealthModule {}
