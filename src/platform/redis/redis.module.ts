import { Module } from '@nestjs/common'

import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'

import { RedisClientFactory } from './redis-client.factory'
import { RedisCoordinationConnectionManager } from './redis-coordination.connection'
import { RedisLifecycle } from './redis-lifecycle'
import { RedisReadinessIndicator } from './redis-readiness.indicator'
import {
  REDIS_COORDINATION_COMMAND_EXECUTOR,
  REDIS_LIFECYCLE,
  REDIS_READINESS_INDICATOR,
} from './redis.tokens'

/** Composes the coordination Redis connection, executor, readiness and lifecycle. */
@Module({
  imports: [RuntimeConfigModule],
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
      provide: RedisCoordinationConnectionManager,
      inject: [RedisClientFactory, RuntimeConfigService],
      useFactory: (
        factory: RedisClientFactory,
        config: RuntimeConfigService,
      ): RedisCoordinationConnectionManager =>
        new RedisCoordinationConnectionManager(factory, config.redis),
    },
    {
      provide: RedisLifecycle,
      inject: [RedisCoordinationConnectionManager, RuntimeConfigService],
      useFactory: (
        connection: RedisCoordinationConnectionManager,
        config: RuntimeConfigService,
      ): RedisLifecycle =>
        new RedisLifecycle(connection, config.redis.shutdownTimeoutMs),
    },
    {
      provide: RedisReadinessIndicator,
      inject: [RedisCoordinationConnectionManager, RuntimeConfigService],
      useFactory: (
        connection: RedisCoordinationConnectionManager,
        config: RuntimeConfigService,
      ): RedisReadinessIndicator =>
        new RedisReadinessIndicator(connection, config.redis.healthTimeoutMs),
    },
    {
      provide: REDIS_COORDINATION_COMMAND_EXECUTOR,
      inject: [RedisCoordinationConnectionManager],
      useFactory: (connection: RedisCoordinationConnectionManager) =>
        connection.commandExecutor,
    },
    { provide: REDIS_LIFECYCLE, useExisting: RedisLifecycle },
    {
      provide: REDIS_READINESS_INDICATOR,
      useExisting: RedisReadinessIndicator,
    },
  ],
  exports: [
    REDIS_COORDINATION_COMMAND_EXECUTOR,
    REDIS_LIFECYCLE,
    REDIS_READINESS_INDICATOR,
  ],
})
export class RedisModule {}
