import { Module } from '@nestjs/common'

import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'

import { RedisClientFactory } from './redis-client.factory'
import { RedisAuthConnectionManager } from './redis-auth.connection'
import { RedisLifecycle } from './redis-lifecycle'
import { RedisReadinessIndicator } from './redis-readiness.indicator'
import {
  REDIS_AUTH_COMMAND_EXECUTOR,
  REDIS_LIFECYCLE,
  REDIS_READINESS_INDICATOR,
} from './redis.tokens'

/** Composes the auth Redis connection, executor, readiness and lifecycle. */
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
      provide: RedisAuthConnectionManager,
      inject: [RedisClientFactory, RuntimeConfigService],
      useFactory: (
        factory: RedisClientFactory,
        config: RuntimeConfigService,
      ): RedisAuthConnectionManager =>
        new RedisAuthConnectionManager(factory, config.redis),
    },
    {
      provide: RedisLifecycle,
      inject: [RedisAuthConnectionManager, RuntimeConfigService],
      useFactory: (
        connection: RedisAuthConnectionManager,
        config: RuntimeConfigService,
      ): RedisLifecycle =>
        new RedisLifecycle(connection, config.redis.shutdownTimeoutMs),
    },
    {
      provide: RedisReadinessIndicator,
      inject: [RedisAuthConnectionManager, RuntimeConfigService],
      useFactory: (
        connection: RedisAuthConnectionManager,
        config: RuntimeConfigService,
      ): RedisReadinessIndicator =>
        new RedisReadinessIndicator(connection, config.redis.healthTimeoutMs),
    },
    {
      provide: REDIS_AUTH_COMMAND_EXECUTOR,
      inject: [RedisAuthConnectionManager],
      useFactory: (connection: RedisAuthConnectionManager) =>
        connection.commandExecutor,
    },
    { provide: REDIS_LIFECYCLE, useExisting: RedisLifecycle },
    {
      provide: REDIS_READINESS_INDICATOR,
      useExisting: RedisReadinessIndicator,
    },
  ],
  exports: [
    REDIS_AUTH_COMMAND_EXECUTOR,
    REDIS_LIFECYCLE,
    REDIS_READINESS_INDICATOR,
  ],
})
export class RedisModule {}
