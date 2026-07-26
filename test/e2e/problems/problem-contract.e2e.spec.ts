import type { Server } from 'node:http'

import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UnsupportedMediaTypeException,
  type INestApplication,
} from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request, { type Response } from 'supertest'

import {
  AuthDependencyUnavailableError,
  AuthenticationFailedError,
  AuthorizationDeniedError,
  AuthRateLimitedError,
  AuthStateConflictError,
} from '@/modules/auth/application/auth-errors'
import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { runtimeDefaults } from '@/platform/config/runtime-defaults'
import { configureHttpApplication } from '@/platform/http/bootstrap/configure-http-application'
import { RequestContext } from '@/platform/http/context/request-context'
import { HttpErrorsModule } from '@/platform/http/errors/http-errors.module'
import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'
import { STRUCTURED_LOGGER } from '@/platform/logging/logging.contracts'
import { LoggingModule } from '@/platform/logging/logging.module'
import { TestHttpModule } from '@test/e2e/fixtures/http/test-http.module'
import { TestRequestDto } from '@test/e2e/fixtures/http/test-request.dto'
import { requiredRuntimeEnvironment } from '@test/support/required-runtime-environment'

@Controller('technical/problems')
class ProblemFixtureController {
  @Post('validate')
  public validate(@Body() body: TestRequestDto): TestRequestDto {
    return body
  }

  @Get(':kind')
  public fail(@Param('kind') kind: string): never {
    switch (kind) {
      case 'authentication':
        throw new AuthenticationFailedError()
      case 'authorization':
        throw new AuthorizationDeniedError()
      case 'conflict':
        throw new AuthStateConflictError()
      case 'unsupported-media':
        throw new UnsupportedMediaTypeException('raw media detail')
      case 'rate-limit':
        throw new AuthRateLimitedError(1_001)
      case 'dependency':
        throw new AuthDependencyUnavailableError()
      case 'unknown':
        throw new Error(
          'password=top-secret postgresql://user:secret@localhost/internal',
        )
      default:
        throw new NotFoundException('raw route detail')
    }
  }
}

describe('RFC 9457 problem HTTP contract', () => {
  let app: INestApplication
  let server: Server
  const logger = { write: jest.fn() }
  const requestId = '019219c3-dc52-7cc1-9e70-f293ca14c198'

  beforeAll(async () => {
    const runtimeConfig = buildApiRuntimeConfig(
      requiredRuntimeEnvironment({
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      }),
    )
    const moduleRef = await Test.createTestingModule({
      imports: [
        RuntimeConfigModule.forRoot(runtimeConfig),
        LoggingModule.forRoot(),
        HttpErrorsModule,
        TestHttpModule,
      ],
      controllers: [ProblemFixtureController],
    })
      .overrideProvider(STRUCTURED_LOGGER)
      .useValue(logger)
      .compile()
    const expressApp = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    })
    const lifecycle = expressApp.get(ApplicationLifecycleState)
    lifecycle.markReady()
    configureHttpApplication(
      expressApp,
      expressApp.get(RuntimeConfigService),
      lifecycle,
      expressApp.get(RequestContext),
    )
    await expressApp.init()
    await expressApp.listen(0, '127.0.0.1')
    app = expressApp
    server = app.getHttpServer() as Server
  })

  afterAll(async () => app.close())

  it.each([
    ['authentication', 401, 'AUTHENTICATION_REQUIRED'],
    ['authorization', 403, 'AUTHORIZATION_DENIED'],
    ['missing', 404, 'NOT_FOUND'],
    ['conflict', 409, 'CONFLICT'],
    ['unsupported-media', 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['rate-limit', 429, 'RATE_LIMIT_EXCEEDED'],
    ['dependency', 503, 'DEPENDENCY_UNAVAILABLE'],
  ] as const)('maps %s to one safe problem', async (kind, status, code) => {
    const response = await request(server)
      .get(`/v1/technical/problems/${kind}`)
      .set('X-Request-ID', requestId)
      .expect(status)

    expectProblem(response, status, code, requestId)
    expect(JSON.stringify(response.body)).not.toContain('raw')
    if (kind === 'rate-limit') {
      expect(response.headers['retry-after']).toBe('2')
    }
  })

  it('keeps malformed JSON at 400 and payload limit at 413', async () => {
    const malformed = await request(server)
      .post('/v1/technical/problems/validate')
      .set('X-Request-ID', requestId)
      .set('Content-Type', 'application/json')
      .send('{"value":')
      .expect(400)
    expectProblem(malformed, 400, 'MALFORMED_REQUEST', requestId)

    const oversized = await request(server)
      .post('/v1/technical/problems/validate')
      .set('X-Request-ID', requestId)
      .send({ value: 'x'.repeat(runtimeDefaults.http.jsonBodyLimitBytes) })
      .expect(413)
    expectProblem(oversized, 413, 'PAYLOAD_TOO_LARGE', requestId)
  })

  it('returns value-free field errors for validation failures', async () => {
    const response = await request(server)
      .post('/v1/technical/problems/validate')
      .set('X-Request-ID', requestId)
      .send({ value: 42, secret: 'top-secret' })
      .expect(422)

    expectProblem(response, 422, 'VALIDATION_FAILED', requestId)
    const body = problemBody(response)
    expect(body['errors']).toEqual([
      {
        pointer: '/secret',
        code: 'unknown_field',
        detail: 'Field is not allowed.',
      },
      {
        pointer: '/value',
        code: 'invalid_type',
        detail: 'Field has an invalid type.',
      },
      {
        pointer: '/value',
        code: 'too_short',
        detail: 'Field is shorter than allowed.',
      },
    ])
    expect(JSON.stringify(body)).not.toContain('top-secret')
  })

  it('returns a byte-safe constant 500 and logs the original only to the sink', async () => {
    const response = await request(server)
      .get('/v1/technical/problems/unknown')
      .set('X-Request-ID', requestId)
      .expect(500)

    expectProblem(response, 500, 'INTERNAL_ERROR', requestId)
    expect(JSON.stringify(response.body)).not.toContain('top-secret')
    expect(logger.write.mock.calls).toEqual([
      [
        expect.objectContaining({
          event: 'http_unhandled_error',
          module: 'ProblemExceptionFilter',
        }),
      ],
    ])
  })
})

function expectProblem(
  response: Response,
  status: number,
  code: string,
  expectedRequestId: string,
): void {
  const body = problemBody(response)
  expect(response.headers['content-type']).toMatch(
    /^application\/problem\+json(?:; charset=utf-8)?$/u,
  )
  expect(response.headers['x-request-id']).toBe(expectedRequestId)
  expect(body['type']).toEqual(
    expect.stringMatching(
      /^https:\/\/nest-js-starter\.invalid\/problems\/[a-z0-9-]+$/u,
    ),
  )
  expect(typeof body['title']).toBe('string')
  expect(body['status']).toBe(status)
  expect(typeof body['detail']).toBe('string')
  expect(body['instance']).toBe(`urn:request:${expectedRequestId}`)
  expect(body['code']).toBe(code)
  expect(body['requestId']).toBe(expectedRequestId)
  expect(body['status']).toBe(response.status)
}

function problemBody(response: Response): Readonly<Record<string, unknown>> {
  const body: unknown = response.body
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Expected an object problem body')
  }
  return body as Readonly<Record<string, unknown>>
}
