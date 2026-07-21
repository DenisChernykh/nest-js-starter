import type { AddressInfo } from 'node:net'

import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
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
import type { ShutdownParticipant } from '@/platform/lifecycle/shutdown-participant'
import { ActiveOperationTracker } from '@/platform/http/bootstrap/active-operation-tracker'
import { ActiveRequestTracker } from '@/platform/http/bootstrap/active-request-tracker'

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

/** Resources created before the explicit database startup step. */
export interface ApiRuntimeResources {
  readonly application: ApiApplicationHandle
  readonly database: DatabaseLifecycle
  readonly lifecycle: ApiLifecycleHandle
  readonly requestTracker?: ActiveRequestTracker
  readonly operationTracker?: ActiveOperationTracker
  readonly shutdownRegistry?: ShutdownRegistry
  readonly httpDrainTimeoutMs?: number
  readonly shutdownGraceMs?: number
}

/** Creates, configures and initializes the API without opening its listener. */
export async function configureApi(): Promise<ApiRuntimeResources> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
    bodyParser: false,
  })
  const config = app.get(RuntimeConfigService)
  const lifecycle = app.get(ApplicationLifecycleState)
  const registry = app.get(HealthRegistry)
  const probe = app.get<DatabaseReadinessProbe>(DATABASE_READINESS_PROBE)
  const database = app.get<DatabaseLifecycle>(DATABASE_LIFECYCLE)
  const requestTracker = app.get(ActiveRequestTracker)
  const operationTracker = app.get(ActiveOperationTracker)
  const shutdownRegistry = app.get(ShutdownRegistry)
  registry.register(probe)
  registry.seal()
  shutdownRegistry.register(database as DatabaseLifecycle & ShutdownParticipant)
  shutdownRegistry.seal()
  configureHttpApplication(app, config, lifecycle, requestTracker)
  await app.init()

  return {
    database,
    lifecycle,
    requestTracker,
    operationTracker,
    shutdownRegistry,
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
              error instanceof Error ? error : new Error('Listener close failed'),
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
