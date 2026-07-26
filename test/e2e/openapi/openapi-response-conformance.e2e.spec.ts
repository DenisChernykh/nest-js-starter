import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import {
  createAuthTestHarness,
  type AuthTestHarness,
} from '@test/e2e/auth/auth-test-harness'
import { TestHealthModule } from '@test/e2e/fixtures/health/test-health.module'
import { assertOpenApiResponseConforms } from '@test/e2e/openapi/openapi-test-harness'
import { HealthRegistry } from '@/platform/http/health/health-registry'
import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'

describe('committed OpenAPI response conformance', () => {
  let healthApp: INestApplication
  let healthServer: Server
  let lifecycle: ApplicationLifecycleState
  let databaseStatus: 'up' | 'down'
  let auth: AuthTestHarness

  beforeAll(async () => {
    databaseStatus = 'up'
    const moduleRef = await Test.createTestingModule({
      imports: [TestHealthModule],
    })
      .overrideProvider(HealthRegistry)
      .useFactory({
        factory: () =>
          new HealthRegistry([
            {
              name: 'postgresql',
              required: true,
              timeoutMs: 100,
              check: () => Promise.resolve(databaseStatus),
            },
            {
              name: 'redis-coordination',
              required: true,
              timeoutMs: 100,
              check: () => Promise.resolve('up'),
            },
          ]),
      })
      .compile()
    healthApp = moduleRef.createNestApplication()
    lifecycle = healthApp.get(ApplicationLifecycleState)
    await healthApp.init()
    healthServer = healthApp.getHttpServer() as Server
    auth = await createAuthTestHarness()
  })

  afterAll(async () => {
    await Promise.all([healthApp.close(), auth.app.close()])
  })

  it('validates live, startup and dynamic readiness maps', async () => {
    const live = await request(healthServer).get('/health/live').expect(200)
    await assertOpenApiResponseConforms('healthLive', live)

    const starting = await request(healthServer)
      .get('/health/startup')
      .expect(503)
    await assertOpenApiResponseConforms('healthStartup', starting)
    const unavailable = await request(healthServer)
      .get('/health/ready')
      .expect(503)
    await assertOpenApiResponseConforms('healthReady', unavailable)

    lifecycle.markReady()
    const started = await request(healthServer)
      .get('/health/startup')
      .expect(200)
    await assertOpenApiResponseConforms('healthStartup', started)
    const ready = await request(healthServer).get('/health/ready').expect(200)
    await assertOpenApiResponseConforms('healthReady', ready)

    databaseStatus = 'down'
    const degraded = await request(healthServer)
      .get('/health/ready')
      .expect(503)
    await assertOpenApiResponseConforms('healthReady', degraded)
  })

  it('validates auth DTOs, date-times, nested sessions, path and empty 204', async () => {
    const login = await request(auth.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .send({ email: 'user@example.com', password: 'correct password' })
      .expect(200)
    await assertOpenApiResponseConforms('authLogin', login)

    const cookie = `${auth.cookieName}=${auth.rawToken}`
    const me = await request(auth.server)
      .get('/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200)
    await assertOpenApiResponseConforms('authGetMe', me)
    const csrf = await request(auth.server)
      .get('/v1/auth/csrf')
      .set('Cookie', cookie)
      .expect(200)
    await assertOpenApiResponseConforms('authGetCsrfToken', csrf)
    const sessions = await request(auth.server)
      .get('/v1/auth/sessions')
      .set('Cookie', cookie)
      .expect(200)
    await assertOpenApiResponseConforms('authListSessions', sessions)

    const password = await request(auth.server)
      .put('/v1/auth/password')
      .set('Cookie', cookie)
      .set('Origin', 'https://app.example.com')
      .set('X-CSRF-Token', auth.csrfToken)
      .send({
        currentPassword: 'current password',
        newPassword: 'new secure password',
      })
      .expect(200)
    await assertOpenApiResponseConforms('authChangePassword', password)

    const logoutAll = await request(auth.server)
      .delete('/v1/auth/sessions')
      .set('Cookie', cookie)
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', auth.csrfToken)
      .send()
      .expect(200)
    await assertOpenApiResponseConforms('authLogoutAll', logoutAll)

    const revoke = await request(auth.server)
      .delete(`/v1/auth/sessions/${'A'.repeat(22)}`)
      .set('Cookie', cookie)
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', auth.csrfToken)
      .send()
      .expect(204)
    await assertOpenApiResponseConforms('authRevokeSession', revoke)
    const logout = await request(auth.server)
      .post('/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', auth.csrfToken)
      .send()
      .expect(204)
    await assertOpenApiResponseConforms('authLogout', logout)
  })

  it('validates login origin and media-type policy failures', async () => {
    const deniedOrigin = await request(auth.server)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'user@example.com', password: 'correct password' })
      .expect(403)
    await assertOpenApiResponseConforms('authLogin', deniedOrigin)

    const unsupportedMediaType = await request(auth.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'text/plain')
      .send('not-json')
      .expect(415)
    await assertOpenApiResponseConforms('authLogin', unsupportedMediaType)
  })
})
