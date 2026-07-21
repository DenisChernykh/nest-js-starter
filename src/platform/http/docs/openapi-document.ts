import type { INestApplication } from '@nestjs/common'
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger'

import type { ApplicationRuntimeConfig } from '@/platform/config/runtime-config.types'

/**
 * Builds the single code-first OpenAPI document for offline and runtime use.
 *
 * @param app - Nest application carrying the complete controller/DTO graph.
 * @param config - Validated config supplying the runtime cookie name.
 * @returns OpenAPI 3 document generated only from explicit presentation data.
 */
export function createOpenApiDocument(
  app: INestApplication,
  config: ApplicationRuntimeConfig,
): OpenAPIObject {
  const documentConfig = new DocumentBuilder()
    .setTitle('NestJS Starter API')
    .setDescription('Reusable production NestJS backend starter contract.')
    .setVersion('0.1.0')
    .setOpenAPIVersion('3.0.3')
    .addTag('health', 'Process lifecycle and dependency health probes.')
    .addTag('auth', 'Hardened browser-session authentication endpoints.')
    .addCookieAuth(
      config.auth.sessionCookieName,
      {
        type: 'apiKey',
        in: 'cookie',
        name: config.auth.sessionCookieName,
        description: 'Opaque HttpOnly browser session cookie.',
      },
      'sessionCookie',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
        description: 'Session-bound token required together with the cookie.',
      },
      'csrfToken',
    )
    .build()

  return SwaggerModule.createDocument(app, documentConfig, {
    autoTagControllers: false,
    deepScanRoutes: true,
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey}.${methodKey}`,
  })
}
