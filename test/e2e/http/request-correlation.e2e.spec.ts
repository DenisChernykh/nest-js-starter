import type { Server } from 'node:http'

import { Controller, Get, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { configureHttpApplication } from '@/platform/http/bootstrap/configure-http-application'
import { HealthRegistry } from '@/platform/http/health/health-registry'
import { RequestContext } from '@/platform/http/context/request-context'
import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'
import { TestHttpModule } from '@test/e2e/fixtures/http/test-http.module'
import { requiredRuntimeEnvironment } from '@test/support/required-runtime-environment'

@Controller('technical/correlation')
class CorrelationController {
  public constructor(private readonly requestContext: RequestContext) {}

  @Get()
  public get(): { readonly requestId: string | undefined } {
    return { requestId: this.requestContext.getRequestId() }
  }
}

describe('request correlation HTTP boundary', () => {
  let app: INestApplication
  let server: Server

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestHttpModule],
      controllers: [CorrelationController],
      providers: [RequestContext],
    }).compile()
    const expressApp = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    })
    const config = new RuntimeConfigService(
      buildApiRuntimeConfig(
        requiredRuntimeEnvironment({
          DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        }),
      ),
    )
    const lifecycle = expressApp.get(ApplicationLifecycleState)
    const requestContext = expressApp.get(RequestContext)
    expressApp.get(HealthRegistry).seal()
    lifecycle.markReady()
    configureHttpApplication(expressApp, config, lifecycle, requestContext)
    await expressApp.init()
    await expressApp.listen(0, '127.0.0.1')
    app = expressApp
    server = app.getHttpServer() as Server
  })

  afterAll(async () => app.close())

  it('echoes a trusted request ID into response and handler context', async () => {
    const requestId = '019219c3-dc52-7cc1-9e70-f293ca14c198'
    const response = await request(server)
      .get('/v1/technical/correlation')
      .set('X-Request-ID', requestId)
      .expect(200)

    expect(response.headers['x-request-id']).toBe(requestId)
    expect(response.body).toEqual({ requestId })
  })

  it.each(['lowercase-ulid', ' value-with-space '])(
    'replaces rejected inbound ID %s with one generated UUID',
    async (candidate) => {
      const response = await request(server)
        .get('/v1/technical/correlation')
        .set('X-Request-ID', candidate)
        .expect(200)
      const generated = response.headers['x-request-id'] as string

      expect(generated).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      )
      expect(generated).not.toBe(candidate)
      expect(response.body).toEqual({ requestId: generated })
    },
  )
})
