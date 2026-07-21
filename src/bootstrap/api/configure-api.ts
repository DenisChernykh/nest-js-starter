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

import { ApiModule } from './api.module'

/** Minimal application handle owned by the startup runtime. */
export interface ApiApplicationHandle {
  listen(): Promise<void>
  close(): Promise<void>
  address(): AddressInfo | string | null
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
  registry.register(probe)
  registry.seal()
  configureHttpApplication(app, config, lifecycle)
  await app.init()

  return {
    database,
    lifecycle,
    application: {
      listen: async () => {
        await app.listen(config.http.port, config.http.host)
      },
      close: () => app.close(),
      address: () => app.getHttpServer().address(),
    },
  }
}
