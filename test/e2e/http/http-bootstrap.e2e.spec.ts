import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'

import { AUTH_HTTP_PROBLEM_CONTRIBUTION } from '@/modules/auth/composition/auth-http-problem.contribution'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { runtimeDefaults } from '@/platform/config/runtime-defaults'
import { configureHttpApplication } from '@/platform/http/bootstrap/configure-http-application'
import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'
import { RequestContext } from '@/platform/http/context/request-context'
import { CORE_HTTP_PROBLEM_CONTRIBUTION } from '@/platform/http/errors/http-problem.mapper'
import { HttpProblemRegistry } from '@/platform/http/errors/http-problem.registry'
import { ProblemExceptionFilter } from '@/platform/http/errors/problem-exception.filter'
import { TestHttpModule } from '@test/e2e/fixtures/http/test-http.module'
import { requiredRuntimeEnvironment } from '@test/support/required-runtime-environment'

describe('hardened HTTP bootstrap', () => {
  let app: INestApplication
  let server: Server
  let trustedApp: INestApplication
  let trustedServer: Server
  let lifecycle: ApplicationLifecycleState

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestHttpModule],
    }).compile()
    const expressApp = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    })
    const environment = buildApiRuntimeConfig(
      requiredRuntimeEnvironment({
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        CORS_ORIGINS: 'https://allowed.example',
        TRUST_PROXY_CIDRS: '10.0.0.0/8',
      }),
    )
    const config = new RuntimeConfigService(environment)
    const requestContext = new RequestContext()
    expressApp.useGlobalFilters(
      new ProblemExceptionFilter(
        expressApp.get(HttpAdapterHost),
        requestContext,
        { write: jest.fn() },
        new HttpProblemRegistry([
          CORE_HTTP_PROBLEM_CONTRIBUTION,
          AUTH_HTTP_PROBLEM_CONTRIBUTION,
        ]),
      ),
    )
    lifecycle = expressApp.get(ApplicationLifecycleState)
    configureHttpApplication(expressApp, config, lifecycle, requestContext)
    await expressApp.init()
    await expressApp.listen(0, '127.0.0.1')
    app = expressApp
    server = app.getHttpServer() as Server

    const trustedModuleRef = await Test.createTestingModule({
      imports: [TestHttpModule],
    }).compile()
    const trustedExpress =
      trustedModuleRef.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      })
    const trustedEnvironment = buildApiRuntimeConfig(
      requiredRuntimeEnvironment({
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        TRUST_PROXY_CIDRS: '127.0.0.1/32,::1/128',
      }),
    )
    const trustedConfig = new RuntimeConfigService(trustedEnvironment)
    trustedExpress.get(ApplicationLifecycleState).markReady()
    configureHttpApplication(
      trustedExpress,
      trustedConfig,
      trustedExpress.get(ApplicationLifecycleState),
      new RequestContext(),
    )
    await trustedExpress.init()
    await trustedExpress.listen(0, '127.0.0.1')
    trustedApp = trustedExpress
    trustedServer = trustedApp.getHttpServer() as Server
  })

  afterAll(async () => {
    await Promise.all([app.close(), trustedApp.close()])
  })

  it('keeps health unprefixed and gates /v1 traffic by lifecycle', async () => {
    await request(server).get('/health/live').expect(200, { status: 'ok' })
    await request(server)
      .post('/v1/technical/echo')
      .send({ value: 'ok' })
      .expect(503)
    lifecycle.markReady()
    await request(server)
      .post('/technical/echo')
      .send({ value: 'ok' })
      .expect(404)
    await request(server)
      .post('/v1/technical/echo')
      .send({ value: 'ok' })
      .expect(201, { value: 'ok' })
  })

  it('applies strict DTO validation and the JSON byte limit', async () => {
    await request(server)
      .post('/v1/technical/echo')
      .send({ value: 'ok', extra: true })
      .expect(422)
    await request(server).post('/v1/technical/echo').send({}).expect(422)
    await request(server)
      .post('/v1/technical/echo')
      .send({ value: 42 })
      .expect(422)
    await request(server)
      .post('/v1/technical/echo')
      .send({ value: 'x'.repeat(runtimeDefaults.http.jsonBodyLimitBytes) })
      .expect(413)
  })

  it('sets Helmet and exact CORS policy', async () => {
    await request(server)
      .get('/health/live')
      .expect('x-content-type-options', 'nosniff')
    await request(server)
      .get('/health/live')
      .set('Origin', 'https://allowed.example')
      .expect('access-control-allow-origin', 'https://allowed.example')
      .expect('access-control-allow-credentials', 'true')
    const blocked = await request(server)
      .get('/health/live')
      .set('Origin', 'https://blocked.example')
      .expect(200)
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined()
    expect(blocked.headers['access-control-allow-credentials']).toBeUndefined()
    await request(server).get('/health/live').expect(200)
  })

  it('does not trust X-Forwarded-For from an untrusted peer', async () => {
    const response = await request(server)
      .get('/v1/technical/ip')
      .set('X-Forwarded-For', '203.0.113.10')
      .expect(200)
    expect(response.body).not.toEqual({ ip: '203.0.113.10' })
  })

  it('uses X-Forwarded-For from an explicitly trusted peer CIDR', async () => {
    await request(trustedServer)
      .get('/v1/technical/ip')
      .set('X-Forwarded-For', '203.0.113.10')
      .expect(200, { ip: '203.0.113.10' })
  })

  it('sets exact Node HTTP timeouts and gates drain traffic', async () => {
    expect(server.requestTimeout).toBe(runtimeDefaults.http.requestTimeoutMs)
    expect(server.headersTimeout).toBe(runtimeDefaults.http.headersTimeoutMs)
    expect(server.keepAliveTimeout).toBe(
      runtimeDefaults.http.keepAliveTimeoutMs,
    )
    lifecycle.beginDrain()
    await request(server)
      .post('/v1/technical/echo')
      .send({ value: 'ok' })
      .expect(503)
    await request(server).get('/health/ready').expect(503)
  })
})
