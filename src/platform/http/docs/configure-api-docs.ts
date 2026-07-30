import type { NestExpressApplication } from '@nestjs/platform-express'
import { SwaggerModule } from '@nestjs/swagger'

import type { ApplicationRuntimeConfig } from '@/platform/config/runtime-config.types'
import type { RequestContext } from '@/platform/http/context/request-context'
import type { RegisteredProblemDefinition } from '@/platform/http/errors/problem.contracts'

import type { DocsAccessPolicy } from './docs-access.contracts'
import { createDocsAccessMiddleware } from './docs-access.middleware'
import { createOpenApiDocument } from './openapi-document'

/**
 * Registers the single runtime Swagger UI and JSON surface for the chosen mode.
 *
 * @param app - Configured Nest Express application before initialization.
 * @param config - Validated runtime config and cookie-name projection.
 * @param requestContext - Already-mounted correlation context.
 * @param protectedPolicy - Auth policy available only in protected mode.
 * @param problems - Complete process-owned problem catalog exposed by docs.
 */
export function configureApiDocs(
  app: NestExpressApplication,
  config: ApplicationRuntimeConfig,
  requestContext: RequestContext,
  protectedPolicy: DocsAccessPolicy | null,
  problems: readonly RegisteredProblemDefinition[],
): void {
  if (config.docs.mode === 'off') return
  if (config.docs.mode === 'protected') {
    if (protectedPolicy === null) {
      throw new Error('Protected API docs policy is unavailable')
    }
    app.use(createDocsAccessMiddleware(protectedPolicy, requestContext))
  }

  const document = createOpenApiDocument(app, config, problems)
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: '/openapi.json',
    raw: ['json'],
    swaggerUrl: '/openapi.json',
    swaggerOptions: {
      persistAuthorization: false,
      withCredentials: true,
    },
    ui: true,
  })
}
