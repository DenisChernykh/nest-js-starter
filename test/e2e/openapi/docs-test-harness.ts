import { type IncomingMessage, Server, type ServerResponse } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import type { RequestHandler } from 'express'

import { createOpenApiRuntimeConfig } from '@/bootstrap/contracts/openapi-runtime-config'
import type { ApiDocsMode } from '@/platform/config/runtime-config.types'
import type {
  DocsAccessDecision,
  DocsAccessPolicy,
} from '@/platform/http/docs/docs-access.contracts'
import { configureApiDocs } from '@/platform/http/docs/configure-api-docs'
import { RequestContext } from '@/platform/http/context/request-context'
import { createRequestContextMiddleware } from '@/platform/http/context/request-context.middleware'

type HttpServer = Server<typeof IncomingMessage, typeof ServerResponse>

function isHttpServer(value: unknown): value is HttpServer {
  return value instanceof Server
}

/** Running isolated documentation server with deterministic policy and logs. */
export interface DocsTestHarness {
  readonly app: INestApplication
  readonly server: HttpServer
  readonly authorize: jest.Mock
  readonly accessLogPaths: readonly string[]
}

/**
 * Starts the real docs route configuration without runtime dependency startup.
 *
 * @param mode - Documentation exposure mode under test.
 * @param decision - Finite protected-mode decision returned by the policy.
 * @returns Initialized loopback Nest server and observable policy/log calls.
 */
export async function createDocsTestHarness(
  mode: ApiDocsMode,
  decision: DocsAccessDecision = { allowed: true },
): Promise<DocsTestHarness> {
  const moduleRef = await Test.createTestingModule({}).compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>()
  const requestContext = new RequestContext()
  const accessLogPaths: string[] = []
  const authorize = jest.fn(() => Promise.resolve(decision))
  const policy: DocsAccessPolicy = { authorize }
  const base = createOpenApiRuntimeConfig()
  const config = Object.freeze({
    ...base,
    docs: Object.freeze({ mode }),
  })

  app.use(
    createRequestContextMiddleware(
      requestContext,
      () => '019f0000-0000-7000-8000-000000000009',
    ),
  )
  const accessLogMiddleware: RequestHandler = (request, response, next) => {
    response.once('finish', () => accessLogPaths.push(request.path))
    next()
  }
  app.use(accessLogMiddleware)
  configureApiDocs(app, config, requestContext, policy)
  await app.init()
  await app.listen(0, '127.0.0.1')

  const server: unknown = app.getHttpServer()
  if (!isHttpServer(server)) {
    throw new Error('Docs test HTTP server is unavailable')
  }
  return {
    app,
    server,
    authorize,
    accessLogPaths,
  }
}
