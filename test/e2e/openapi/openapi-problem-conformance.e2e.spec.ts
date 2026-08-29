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
} from '@/modules/auth/public-contracts/auth-errors'
import { AUTH_HTTP_PROBLEM_CONTRIBUTION } from '@/modules/auth/composition/auth-http-problem.contribution'
import { API_PROBLEM_CATALOG } from '@/bootstrap/api/api-http-problems'
import { generateOpenApiArtifact } from '@/bootstrap/contracts/generate-openapi'
import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { runtimeDefaults } from '@/platform/config/runtime-defaults'
import { configureHttpApplication } from '@/platform/http/bootstrap/configure-http-application'
import { RequestContext } from '@/platform/http/context/request-context'
import {
  ProblemResponseDto,
  ValidationProblemResponseDto,
} from '@/platform/http/docs/problem-response.dto'
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
    const registryCodes = API_PROBLEM_CATALOG.map(({ code }) => code).sort()
    const problemComponentNames = findProblemComponentNames(document)

    expect(problemComponentNames).toEqual([
      'ProblemResponseDto',
      'ValidationProblemResponseDto',
    ])
    for (const componentName of problemComponentNames) {
      const schema = document.components?.schemas?.[componentName]
      if (schema === undefined || '$ref' in schema) {
        throw new Error(`${componentName} component is unavailable`)
      }
      const codeSchema = schema.properties?.['code']
      if (codeSchema === undefined || '$ref' in codeSchema) {
        throw new Error(`${componentName} code schema is unavailable`)
      }
      const documentedCodes = (codeSchema.enum ?? [])
        .filter((value): value is string => typeof value === 'string')
        .sort()
      expect(codeSchema['pattern']).toBe('^[A-Z][A-Z0-9_]*$')
      expect(documentedCodes).toEqual(registryCodes)
    }
    for (const definition of API_PROBLEM_CATALOG) {
      expect(markdown).toContain(definition.type)
      expect(markdown).toContain(definition.code)
    }
    for (const approvalCode of [
      'APPROVAL_REQUEST_NOT_FOUND',
      'APPROVAL_REQUEST_ALREADY_DECIDED',
      'APPROVAL_SELF_DECISION_FORBIDDEN',
    ]) {
      expect(markdown).toContain(approvalCode)
    }
  })

  it.each([
    ['ProblemResponseDto', ProblemResponseDto],
    ['ValidationProblemResponseDto', ValidationProblemResponseDto],
  ] as const)(
    'rejects generation when the %s code schema is unavailable',
    async (componentName, responseType) => {
      const metadataKey = 'swagger/apiModelPropertiesArray'
      const target = responseType.prototype
      const properties = Reflect.getOwnMetadata(metadataKey, target) as string[]
      Reflect.defineMetadata(
        metadataKey,
        properties.filter((property) => property !== ':code'),
        target,
      )

      try {
        await expect(generateOpenApiArtifact()).rejects.toThrow(
          `OpenAPI ${componentName}.code schema is unavailable`,
        )
      } finally {
        Reflect.defineMetadata(metadataKey, properties, target)
      }
    },
  )
})

function findProblemComponentNames(
  document: Awaited<ReturnType<typeof readCommittedOpenApiDocument>>,
): readonly string[] {
  const names = new Set<string>()
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (operation === undefined) continue
      for (const response of Object.values(operation.responses)) {
        if ('$ref' in response) continue
        const schema =
          response.content?.['application/problem+json']?.schema ?? undefined
        if (schema !== undefined) collectProblemComponentNames(schema, names)
      }
    }
  }
  return [...names].sort()
}

function collectProblemComponentNames(
  schema: Readonly<Record<string, unknown>>,
  names: Set<string>,
): void {
  const reference = schema['$ref']
  if (
    typeof reference === 'string' &&
    reference.startsWith('#/components/schemas/')
  ) {
    names.add(reference.slice('#/components/schemas/'.length))
  }
  const alternatives = schema['oneOf']
  if (!isUnknownArray(alternatives)) return
  for (const alternative of alternatives) {
    if (isReadonlyRecord(alternative)) {
      collectProblemComponentNames(alternative, names)
    }
  }
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

function isReadonlyRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
