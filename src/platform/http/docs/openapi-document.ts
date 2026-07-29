import type { INestApplication } from '@nestjs/common'
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger'

import type { ApplicationRuntimeConfig } from '@/platform/config/runtime-config.types'
import type { RegisteredProblemDefinition } from '@/platform/http/errors/problem.contracts'

/**
 * Builds the single code-first OpenAPI document for offline and runtime use.
 *
 * @param app - Nest application carrying the complete controller/DTO graph.
 * @param config - Validated config supplying the runtime cookie name.
 * @param problems - Complete process-owned problem catalog published as the
 * finite response-code enum.
 * @returns OpenAPI 3 document generated from explicit presentation data and
 * the supplied process composition.
 * @throws Error when a generated problem component omits its `code` property.
 */
export function createOpenApiDocument(
  app: INestApplication,
  config: ApplicationRuntimeConfig,
  problems: readonly RegisteredProblemDefinition[],
): OpenAPIObject {
  const documentConfig = new DocumentBuilder()
    .setTitle('NestJS Starter API')
    .setDescription('Reusable production NestJS backend starter contract.')
    .setVersion('0.1.0')
    .setOpenAPIVersion('3.0.3')
    .addServer('/', 'Current API origin.')
    .addTag('health', 'Process lifecycle and dependency health probes.')
    .addTag('auth', 'Hardened browser-session authentication endpoints.')
    .addTag(
      'approval-requests',
      'Reference approval-request creation, visibility and decision workflow.',
    )
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

  const document = SwaggerModule.createDocument(app, documentConfig, {
    autoTagControllers: false,
    deepScanRoutes: true,
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey}.${methodKey}`,
  })
  const problemSchema = document.components?.schemas?.['ProblemResponseDto']
  if (problemSchema === undefined) return document
  const codeSchema =
    '$ref' in problemSchema ? undefined : problemSchema.properties?.['code']
  if (codeSchema === undefined || '$ref' in codeSchema) {
    throw new Error('OpenAPI ProblemResponseDto.code schema is unavailable')
  }
  codeSchema.enum = problems.map(({ code }) => code).sort()
  return document
}
