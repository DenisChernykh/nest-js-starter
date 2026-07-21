import type { AddressInfo } from 'node:net'

import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import type { ApplicationRuntimeConfig } from '@/platform/config/runtime-config.types'
import { createApiRuntimeConfig } from '@/platform/config/runtime-environment'
import type {
  DatabaseLifecycle,
  DatabaseReadinessProbe,
} from '@/platform/database/database.contracts'
import {
  DATABASE_LIFECYCLE,
  DATABASE_READINESS_PROBE,
} from '@/platform/database/database.tokens'
import { configureHttpApplication } from '@/platform/http/bootstrap/configure-http-application'
import { HealthRegistry } from '@/platform/http/health/health-registry'
import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'
import { ShutdownRegistry } from '@/platform/lifecycle/shutdown-registry'
import { StartupRegistry } from '@/platform/lifecycle/startup-registry'
import type { RedisLifecycle } from '@/platform/redis/redis-lifecycle'
import type { RedisReadinessIndicator } from '@/platform/redis/redis-readiness.indicator'
import {
  REDIS_LIFECYCLE,
  REDIS_READINESS_INDICATOR,
} from '@/platform/redis/redis.tokens'
import type { ShutdownParticipant } from '@/platform/lifecycle/shutdown-participant'
import { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'
import { ActiveRequestTracker } from '@/platform/http/bootstrap/active-request-tracker'
import { RequestContext } from '@/platform/http/context/request-context'

import { ApiModule } from './api.module'

/** Minimal application handle owned by the startup runtime. */
export interface ApiApplicationHandle {
  listen(): Promise<void>
  close(): Promise<void>
  address(): AddressInfo | string | null
  /** Stops accepting new connections. */
  closeListener?(): Promise<void>
  /** Closes idle keep-alive connections after listener close. */
  closeIdleConnections?(): void
  /** Force-closes remaining transport connections. */
  closeAllConnections?(): void
}

/** Lifecycle operations required by startup orchestration. */
export interface ApiLifecycleHandle {
  readonly phase: 'starting' | 'ready' | 'draining'
  markReady(): void
  beginDrain(): boolean
}

/** Startup operations required by runtime orchestration without DI internals. */
export interface ApiStartupHandle {
  startAll(signal: AbortSignal): Promise<void>
  stopStarted(signal: AbortSignal): Promise<void>
}

/** Resources created before the explicit database startup step. */
export interface ApiRuntimeResources {
  readonly application: ApiApplicationHandle
  readonly database: DatabaseLifecycle
  readonly lifecycle: ApiLifecycleHandle
  readonly requestTracker?: ActiveRequestTracker
  readonly operationTracker?: ActiveOperationTracker
  readonly shutdownRegistry?: ShutdownRegistry
  readonly startupRegistry?: ApiStartupHandle
  readonly httpDrainTimeoutMs?: number
  readonly shutdownGraceMs?: number
}

/**
 * Creates, configures and initializes the API without opening its listener.
 *
 * @param runtimeConfig - Prevalidated config or process environment projection.
 */
export async function configureApi(
  runtimeConfig: ApplicationRuntimeConfig = createApiRuntimeConfig(),
): Promise<ApiRuntimeResources> {
  const app = await NestFactory.create<NestExpressApplication>(
    ApiModule.forRoot(runtimeConfig),
    {
      bodyParser: false,
    },
  )
  const config = app.get(RuntimeConfigService)
  const lifecycle = app.get(ApplicationLifecycleState)
  const registry = app.get(HealthRegistry)
  const probe = app.get<DatabaseReadinessProbe>(DATABASE_READINESS_PROBE)
  const database = app.get<DatabaseLifecycle>(DATABASE_LIFECYCLE)
  const requestTracker = app.get(ActiveRequestTracker)
  const requestContext = app.get(RequestContext)
  const operationTracker = app.get(ActiveOperationTracker)
  const shutdownRegistry = app.get(ShutdownRegistry)
  const startupRegistry = app.get(StartupRegistry)
  const redis = app.get<RedisLifecycle>(REDIS_LIFECYCLE)
  const redisProbe = app.get<RedisReadinessIndicator>(REDIS_READINESS_INDICATOR)
  registry.register(probe)
  registry.register(redisProbe)
  registry.seal()
  startupRegistry.register({
    name: 'database',
    order: 100,
    start: (signal) => database.connect(signal),
    stop: (signal) => database.close(signal),
  })
  startupRegistry.register({
    name: 'redis',
    order: 200,
    start: (signal) => redis.connect(signal),
    stop: (signal) => redis.close(signal),
  })
  startupRegistry.seal()
  shutdownRegistry.register(redis)
  shutdownRegistry.register(database as DatabaseLifecycle & ShutdownParticipant)
  shutdownRegistry.seal()
  configureHttpApplication(
    app,
    config,
    lifecycle,
    requestContext,
    requestTracker,
  )
  await app.init()

  return {
    database,
    lifecycle,
    requestTracker,
    operationTracker,
    shutdownRegistry,
    startupRegistry,
    httpDrainTimeoutMs: config.http.drainTimeoutMs,
    shutdownGraceMs: config.http.shutdownGraceMs,
    application: {
      listen: async () => {
        await app.listen(config.http.port, config.http.host)
      },
      close: () => app.close(),
      address: () => app.getHttpServer().address(),
      closeListener: () => {
        try {
          app.getHttpServer().close()
        } catch (error: unknown) {
          if (
            (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
          ) {
            return Promise.reject(
              error instanceof Error
                ? error
                : new Error('Listener close failed'),
            )
          }
        }
        return Promise.resolve()
      },
      closeIdleConnections: () => app.getHttpServer().closeIdleConnections(),
      closeAllConnections: () => app.getHttpServer().closeAllConnections(),
    },
  }
}
