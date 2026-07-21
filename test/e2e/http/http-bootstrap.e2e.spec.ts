import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { configureHttpApplication } from '@/platform/http/bootstrap/configure-http-application'
import { HealthRegistry } from '@/platform/http/health/health-registry'
import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'
import { RequestContext } from '@/platform/http/context/request-context'
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
        AUTH_CSRF_ORIGINS: 'https://allowed.example,http://localhost:3000',
        TRUST_PROXY_CIDRS: '10.0.0.0/8',
        HTTP_JSON_BODY_LIMIT_BYTES: '64',
        HTTP_REQUEST_TIMEOUT_MS: '12345',
        HTTP_HEADERS_TIMEOUT_MS: '10000',
        HTTP_KEEP_ALIVE_TIMEOUT_MS: '5000',
      }),
    )
    const config = new RuntimeConfigService(environment)
    lifecycle = expressApp.get(ApplicationLifecycleState)
    const registry = expressApp.get(HealthRegistry)
    registry.register({
      name: 'postgresql',
      required: true,
      timeoutMs: 100,
      check: () => Promise.resolve('up'),
    })
    registry.seal()
    configureHttpApplication(
      expressApp,
      config,
      lifecycle,
      new RequestContext(),
    )
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
    trustedExpress.get(HealthRegistry).seal()
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
      .expect(400)
    await request(server).post('/v1/technical/echo').send({}).expect(400)
    await request(server)
      .post('/v1/technical/echo')
      .send({ value: 42 })
      .expect(400)
    await request(server)
      .post('/v1/technical/echo')
      .send({ value: 'x'.repeat(100) })
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
    expect(server.requestTimeout).toBe(12345)
    expect(server.headersTimeout).toBe(10000)
    expect(server.keepAliveTimeout).toBe(5000)
    lifecycle.beginDrain()
    await request(server)
      .post('/v1/technical/echo')
      .send({ value: 'ok' })
      .expect(503)
    await request(server).get('/health/ready').expect(503)
  })
})
