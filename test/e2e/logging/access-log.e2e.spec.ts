import type { Server } from 'node:http'

import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AUTH_HTTP_PROBLEM_CONTRIBUTION } from '@/modules/auth/composition/auth-http-problem.contribution'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { configureHttpApplication } from '@/platform/http/bootstrap/configure-http-application'
import { RequestContext } from '@/platform/http/context/request-context'
import { CORE_HTTP_PROBLEM_CONTRIBUTION } from '@/platform/http/errors/http-problem.mapper'
import { HttpProblemRegistry } from '@/platform/http/errors/http-problem.registry'
import { ProblemExceptionFilter } from '@/platform/http/errors/problem-exception.filter'
import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'
import { createHttpAccessLogMiddleware } from '@/platform/logging/http-access-log.middleware'
import { TestHttpModule } from '@test/e2e/fixtures/http/test-http.module'
import { TestRequestDto } from '@test/e2e/fixtures/http/test-request.dto'
import { requiredRuntimeEnvironment } from '@test/support/required-runtime-environment'

@Controller('technical/access')
class AccessLogFixtureController {
  @Get('ok/:itemId')
  public ok(@Param('itemId') itemId: string): { readonly itemId: string } {
    return { itemId }
  }

  @Post('validate')
  public validate(@Body() body: TestRequestDto): TestRequestDto {
    return body
  }

  @Get('unknown')
  public unknown(): never {
    throw new Error('private failure detail')
  }
}

describe('final HTTP access records', () => {
  let app: INestApplication
  let server: Server
  const logger = { write: jest.fn() }
  const correlation = { getFields: jest.fn() }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestHttpModule],
      controllers: [AccessLogFixtureController],
    }).compile()
    const expressApp = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    })
    const context = new RequestContext()
    correlation.getFields.mockImplementation(() => ({
      requestId: context.getRequestId(),
    }))
    const config = new RuntimeConfigService(
      buildApiRuntimeConfig(
        requiredRuntimeEnvironment({
          DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        }),
      ),
    )
    const lifecycle = expressApp.get(ApplicationLifecycleState)
    lifecycle.markReady()
    expressApp.useGlobalFilters(
      new ProblemExceptionFilter(
        expressApp.get(HttpAdapterHost),
        context,
        logger,
        new HttpProblemRegistry([
          CORE_HTTP_PROBLEM_CONTRIBUTION,
          AUTH_HTTP_PROBLEM_CONTRIBUTION,
        ]),
      ),
    )
    configureHttpApplication(
      expressApp,
      config,
      lifecycle,
      context,
      undefined,
      createHttpAccessLogMiddleware({ logger, correlation }),
    )
    await expressApp.init()
    await expressApp.listen(0, '127.0.0.1')
    app = expressApp
    server = app.getHttpServer() as Server
  })

  beforeEach(() => {
    logger.write.mockClear()
  })

  afterAll(async () => app.close())

  it('uses the route template and excludes concrete ID/query', async () => {
    await request(server)
      .get('/v1/technical/access/ok/private-id?token=secret')
      .expect(200)

    const access = accessRecords()
    expect(access).toHaveLength(1)
    expect(access[0]).toMatchObject({
      attributes: {
        route: '/v1/technical/access/ok/:itemId',
        method: 'GET',
        status: 200,
      },
    })
    expect(JSON.stringify(access)).not.toContain('private-id')
    expect(JSON.stringify(access)).not.toContain('token')
  })

  it('emits one access and zero stack records for expected 422', async () => {
    await request(server)
      .post('/v1/technical/access/validate')
      .send({ value: 42 })
      .expect(422)

    expect(accessRecords()).toHaveLength(1)
    expect(errorRecords()).toHaveLength(0)
  })

  it('emits one access plus one error record for unknown 500', async () => {
    await request(server).get('/v1/technical/access/unknown').expect(500)

    expect(accessRecords()).toHaveLength(1)
    expect(errorRecords()).toHaveLength(1)
    expect(logger.write.mock.calls).toHaveLength(2)
  })

  function accessRecords(): readonly unknown[] {
    return logger.write.mock.calls
      .map(([record]) => record as unknown)
      .filter(
        (record) =>
          typeof record === 'object' &&
          record !== null &&
          'event' in record &&
          record.event === 'http_request_completed',
      )
  }

  function errorRecords(): readonly unknown[] {
    return logger.write.mock.calls
      .map(([record]) => record as unknown)
      .filter(
        (record) =>
          typeof record === 'object' &&
          record !== null &&
          'event' in record &&
          record.event === 'http_unhandled_error',
      )
  }
})
