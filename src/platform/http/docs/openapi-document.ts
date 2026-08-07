import type { INestApplication } from '@nestjs/common'
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger'

import type { ApplicationRuntimeConfig } from '@/platform/config/runtime-config.types'
import type { RegisteredProblemDefinition } from '@/platform/http/errors/problem.contracts'

const openApiMethods = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const

interface ReferencedProblemSchema {
  readonly $ref?: string
  readonly oneOf?: readonly ReferencedProblemSchema[]
}

/**
 * Builds the single code-first OpenAPI document for offline and runtime use.
 *
 * @param app - Nest application carrying the complete controller/DTO graph.
 * @param config - Validated config supplying the runtime cookie name.
 * @param problems - Complete process-owned problem catalog published as the
 * finite response-code enum.
 * @returns OpenAPI 3 document generated from explicit presentation data and
 * the supplied process composition.
 * @throws Error when a used problem component omits a usable `code` property.
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
    .addTag('admin auth', 'Protected account administration endpoints.')
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
  const problemCodes = problems.map(({ code }) => code).sort()
  for (const componentName of findProblemComponentNames(document)) {
    const problemSchema = document.components?.schemas?.[componentName]
    const codeSchema =
      problemSchema === undefined || '$ref' in problemSchema
        ? undefined
        : problemSchema.properties?.['code']
    if (codeSchema === undefined || '$ref' in codeSchema) {
      throw new Error(`OpenAPI ${componentName}.code schema is unavailable`)
    }
    codeSchema.enum = [...problemCodes]
  }
  return document
}

function findProblemComponentNames(document: OpenAPIObject): readonly string[] {
  const componentNames = new Set<string>()
  for (const pathItem of Object.values(document.paths)) {
    for (const method of openApiMethods) {
      const operation = pathItem[method]
      if (operation === undefined) continue
      for (const response of Object.values(operation.responses)) {
        if (response === undefined) continue
        if ('$ref' in response) continue
        const schema = response.content?.['application/problem+json']?.schema
        if (schema !== undefined) {
          collectProblemComponentNames(schema, componentNames)
        }
      }
    }
  }
  return [...componentNames].sort()
}

function collectProblemComponentNames(
  schema: ReferencedProblemSchema,
  componentNames: Set<string>,
): void {
  const reference = schema.$ref
  const prefix = '#/components/schemas/'
  if (reference?.startsWith(prefix) === true) {
    componentNames.add(reference.slice(prefix.length))
  }
  for (const alternative of schema.oneOf ?? []) {
    collectProblemComponentNames(alternative, componentNames)
  }
}
