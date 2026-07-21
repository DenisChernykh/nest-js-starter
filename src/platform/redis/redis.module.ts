import { Module } from '@nestjs/common'

import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'
import { HealthModule } from '@/platform/http/health/health.module'
import { RuntimeMetrics } from '@/platform/observability/runtime-metrics'

import { RedisClientFactory } from './redis-client.factory'
import { RedisConnectionRegistry } from './redis-connection.registry'
import { RedisLifecycle } from './redis-lifecycle'
import { RedisReadinessIndicator } from './redis-readiness.indicator'
import {
  REDIS_CONNECTION_REGISTRY,
  REDIS_LIFECYCLE,
  REDIS_READINESS_INDICATOR,
} from './redis.tokens'

/** Composes capability-scoped Redis clients, readiness and lifecycle. */
@Module({
  imports: [RuntimeConfigModule, HealthModule],
  providers: [
    {
      provide: RedisClientFactory,
      inject: [RuntimeConfigService],
      useFactory: (config: RuntimeConfigService): RedisClientFactory =>
        new RedisClientFactory({
          connectTimeoutMs: config.redis.connectTimeoutMs,
          commandTimeoutMs: config.redis.commandTimeoutMs,
        }),
    },
    {
      provide: RedisConnectionRegistry,
      inject: [
        RedisClientFactory,
        ActiveOperationTracker,
        RuntimeConfigService,
        RuntimeMetrics,
      ],
      useFactory: (
        factory: RedisClientFactory,
        operationTracker: ActiveOperationTracker,
        config: RuntimeConfigService,
        metrics: RuntimeMetrics,
      ): RedisConnectionRegistry => {
        const registry = new RedisConnectionRegistry(
          factory,
          operationTracker,
          config.redis,
          metrics,
        )
        registry.register('coordination', true)
        registry.seal()
        return registry
      },
    },
    {
      provide: RedisLifecycle,
      inject: [RedisConnectionRegistry, RuntimeConfigService],
      useFactory: (
        registry: RedisConnectionRegistry,
        config: RuntimeConfigService,
      ): RedisLifecycle =>
        new RedisLifecycle(registry, config.redis.shutdownTimeoutMs),
    },
    {
      provide: RedisReadinessIndicator,
      inject: [RedisConnectionRegistry, RuntimeConfigService],
      useFactory: (
        registry: RedisConnectionRegistry,
        config: RuntimeConfigService,
      ): RedisReadinessIndicator =>
        new RedisReadinessIndicator(registry, config.redis.healthTimeoutMs),
    },
    {
      provide: REDIS_CONNECTION_REGISTRY,
      useExisting: RedisConnectionRegistry,
    },
    { provide: REDIS_LIFECYCLE, useExisting: RedisLifecycle },
    {
      provide: REDIS_READINESS_INDICATOR,
      useExisting: RedisReadinessIndicator,
    },
  ],
  exports: [
    REDIS_CONNECTION_REGISTRY,
    REDIS_LIFECYCLE,
    REDIS_READINESS_INDICATOR,
  ],
})
export class RedisModule {}
