import type { Server } from 'node:http'

import { RequestMethod, ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Express } from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'

import type { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import type { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'
import type { RequestContext } from '@/platform/http/context/request-context'
import { createRequestContextMiddleware } from '@/platform/http/context/request-context.middleware'

import { createCorsOptions } from './cors-options'
import { createTrafficGateMiddleware } from './traffic-gate.middleware'
import { trustedProxySetting } from './trusted-proxy'
import type { ActiveRequestTracker } from './active-request-tracker'

/** Applies security-sensitive HTTP policy before application initialization. */
export function configureHttpApplication(
  app: NestExpressApplication,
  config: RuntimeConfigService,
  lifecycle: ApplicationLifecycleState,
  requestContext: RequestContext,
  requestTracker?: ActiveRequestTracker,
): void {
  app.use(createRequestContextMiddleware(requestContext))
  app.use(helmet())
  app.enableCors(createCorsOptions(config.http.corsOrigins))
  const expressApplication: Express = app.getHttpAdapter().getInstance()
  expressApplication.set(
    'trust proxy',
    trustedProxySetting(config.http.trustedProxyCidrs),
  )
  app.use(createTrafficGateMiddleware(lifecycle))
  if (requestTracker !== undefined) app.use(requestTracker.middleware())
  app.use(cookieParser())
  app.useBodyParser('json', { limit: config.http.jsonBodyLimitBytes })
  app.useBodyParser('urlencoded', {
    extended: false,
    limit: config.http.jsonBodyLimitBytes,
  })
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  )
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/startup', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  })
  const server: Server = app.getHttpServer()
  server.requestTimeout = config.http.requestTimeoutMs
  server.headersTimeout = config.http.headersTimeoutMs
  server.keepAliveTimeout = config.http.keepAliveTimeoutMs
}
