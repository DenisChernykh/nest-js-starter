import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { ApiModule } from '@/bootstrap/api/api.module'
import { API_PROBLEM_CATALOG } from '@/bootstrap/api/api-http-problems'
import { configureApiRouteMetadata } from '@/platform/http/bootstrap/configure-http-application'
import { createOpenApiDocument } from '@/platform/http/docs/openapi-document'
import { canonicalizeJson } from '@/platform/http/docs/openapi-normalizer'

import { createOpenApiRuntimeConfig } from './openapi-runtime-config'

/**
 * Generates the complete canonical OpenAPI artifact without runtime startup.
 *
 * @remarks The in-memory application never listens or invokes startup
 * registries. It is closed in a finally block on both success and failure.
 *
 * @returns Byte-stable OpenAPI JSON with one terminal newline.
 */
export async function generateOpenApiArtifact(): Promise<string> {
  const config = createOpenApiRuntimeConfig()
  const app = await NestFactory.create<NestExpressApplication>(
    ApiModule.forRoot(config),
    {
      abortOnError: false,
      bodyParser: false,
      logger: false,
      preview: true,
    },
  )

  try {
    configureApiRouteMetadata(app)
    return canonicalizeJson(
      createOpenApiDocument(app, config, API_PROBLEM_CATALOG),
    )
  } finally {
    await app.close()
  }
}
