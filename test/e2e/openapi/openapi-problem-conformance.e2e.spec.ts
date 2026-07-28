import { readFile } from 'node:fs/promises'
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
import request from 'supertest'

import {
  AuthDependencyUnavailableError,
  AuthenticationFailedError,
  AuthorizationDeniedError,
  AuthRateLimitedError,
} from '@/modules/auth/application/auth-errors'
import { AUTH_HTTP_PROBLEM_CONTRIBUTION } from '@/modules/auth/composition/auth-http-problem.contribution'
import { API_PROBLEM_CATALOG } from '@/bootstrap/api/api-http-problems'
import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { runtimeDefaults } from '@/platform/config/runtime-defaults'
import { configureHttpApplication } from '@/platform/http/bootstrap/configure-http-application'
import { RequestContext } from '@/platform/http/context/request-context'
import { HttpErrorsModule } from '@/platform/http/errors/http-errors.module'
import { CORE_HTTP_PROBLEM_CONTRIBUTION } from '@/platform/http/errors/http-problem.mapper'
import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'
import { STRUCTURED_LOGGER } from '@/platform/logging/logging.contracts'
import { LoggingModule } from '@/platform/logging/logging.module'
import { TestHttpModule } from '@test/e2e/fixtures/http/test-http.module'
import { TestRequestDto } from '@test/e2e/fixtures/http/test-request.dto'
import {
  assertProblemResponseConforms,
  readCommittedOpenApiDocument,
} from '@test/e2e/openapi/openapi-test-harness'
import { requiredRuntimeEnvironment } from '@test/support/required-runtime-environment'

@Controller('technical/openapi-problems')
class OpenApiProblemFixtureController {
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
      case 'unsupported-media':
        throw new UnsupportedMediaTypeException()
      case 'rate-limit':
        throw new AuthRateLimitedError(1_000)
      case 'dependency':
        throw new AuthDependencyUnavailableError()
      case 'unknown':
        throw new Error('private failure')
      default:
        throw new NotFoundException()
    }
  }
}

describe('OpenAPI RFC 9457 conformance', () => {
  let app: INestApplication
  let server: Server

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
        HttpErrorsModule.forRoot([
          CORE_HTTP_PROBLEM_CONTRIBUTION,
          AUTH_HTTP_PROBLEM_CONTRIBUTION,
        ]),
        TestHttpModule,
      ],
      controllers: [OpenApiProblemFixtureController],
    })
      .overrideProvider(STRUCTURED_LOGGER)
      .useValue({ write: jest.fn() })
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
    ['authentication', 401],
    ['authorization', 403],
    ['missing', 404],
    ['unsupported-media', 415],
    ['rate-limit', 429],
    ['unknown', 500],
    ['dependency', 503],
  ] as const)('validates live %s problem status %s', async (kind, status) => {
    const response = await request(server)
      .get(`/v1/technical/openapi-problems/${kind}`)
      .expect(status)
    await assertProblemResponseConforms(response)
  })

  it('validates malformed, oversized and field-validation problems', async () => {
    const malformed = await request(server)
      .post('/v1/technical/openapi-problems/validate')
      .set('Content-Type', 'application/json')
      .send('{"value":')
      .expect(400)
    await assertProblemResponseConforms(malformed)

    const oversized = await request(server)
      .post('/v1/technical/openapi-problems/validate')
      .send({ value: 'x'.repeat(runtimeDefaults.http.jsonBodyLimitBytes) })
      .expect(413)
    await assertProblemResponseConforms(oversized)

    const invalid = await request(server)
      .post('/v1/technical/openapi-problems/validate')
      .send({ value: 42 })
      .expect(422)
    await assertProblemResponseConforms(invalid)
  })

  it('keeps registry, OpenAPI components and Markdown codes exact', async () => {
    const [document, markdown] = await Promise.all([
      readCommittedOpenApiDocument(),
      readFile('docs/api/problem-types.md', 'utf8'),
    ])
    const schema = document.components?.schemas?.['ProblemResponseDto']
    if (schema === undefined || '$ref' in schema) {
      throw new Error('ProblemResponseDto component is unavailable')
    }
    const codeSchema = schema.properties?.['code']
    if (codeSchema === undefined || '$ref' in codeSchema) {
      throw new Error('ProblemResponseDto code schema is unavailable')
    }
    const documentedCodes = (codeSchema.enum ?? [])
      .filter((value): value is string => typeof value === 'string')
      .sort()
    const registryCodes = API_PROBLEM_CATALOG.map(({ code }) => code).sort()

    expect(documentedCodes).toEqual(registryCodes)
    for (const definition of API_PROBLEM_CATALOG) {
      expect(markdown).toContain(definition.type)
      expect(markdown).toContain(definition.code)
    }
  })
})
