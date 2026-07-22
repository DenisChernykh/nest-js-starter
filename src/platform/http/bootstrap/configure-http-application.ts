import type { Server } from 'node:http'

import { RequestMethod, ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Express } from 'express'
import type { RequestHandler } from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'

import type { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import type { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'
import type { RequestContext } from '@/platform/http/context/request-context'
import { createRequestContextMiddleware } from '@/platform/http/context/request-context.middleware'
import { RequestValidationError } from '@/platform/http/errors/request-validation.error'
import { mapValidationErrors } from '@/platform/http/errors/validation-error.mapper'

import { createCorsOptions } from './cors-options'
import { createTrafficGateMiddleware } from './traffic-gate.middleware'
import { trustedProxySetting } from './trusted-proxy'
import type { ActiveRequestTracker } from './active-request-tracker'

/** Applies the production API prefix and its infrastructure-route exclusions. */
export function configureApiRouteMetadata(
  app: Pick<NestExpressApplication, 'setGlobalPrefix'>,
): void {
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/startup', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  })
}

/** Applies security-sensitive HTTP policy before application initialization. */
export function configureHttpApplication(
  app: NestExpressApplication,
  config: RuntimeConfigService,
  lifecycle: ApplicationLifecycleState,
  requestContext: RequestContext,
  requestTracker?: ActiveRequestTracker,
  accessLogMiddleware?: RequestHandler,
): void {
  app.use(createRequestContextMiddleware(requestContext))
  if (accessLogMiddleware !== undefined) app.use(accessLogMiddleware)
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
      exceptionFactory: (errors) =>
        new RequestValidationError(mapValidationErrors(errors)),
    }),
  )
  configureApiRouteMetadata(app)
  const server: Server = app.getHttpServer()
  server.requestTimeout = config.http.requestTimeoutMs
  server.headersTimeout = config.http.headersTimeoutMs
  server.keepAliveTimeout = config.http.keepAliveTimeoutMs
}
