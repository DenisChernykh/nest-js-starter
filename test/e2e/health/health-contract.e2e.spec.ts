import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { HealthRegistry } from '@/platform/http/health/health-registry'
import { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'
import { TestHealthModule } from '@test/e2e/fixtures/health/test-health.module'

describe('health HTTP contract', () => {
  let app: INestApplication
  let server: Server
  let lifecycle: ApplicationLifecycleState
  let databaseStatus: 'up' | 'down'
  let redisStatus: 'up' | 'down'

  beforeAll(async () => {
    databaseStatus = 'up'
    redisStatus = 'up'
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
              name: 'redis-auth',
              required: true,
              timeoutMs: 100,
              check: () => Promise.resolve(redisStatus),
            },
          ]),
      })
      .compile()
    app = moduleRef.createNestApplication()
    lifecycle = app.get(ApplicationLifecycleState)
    await app.init()
    server = app.getHttpServer() as Server
  })

  afterAll(async () => app.close())

  it('serves liveness only outside /v1', async () => {
    await request(server)
      .get('/health/live')
      .expect('Content-Type', /json/)
      .expect(200, { status: 'ok' })
    await request(server).get('/v1/health/live').expect(404)
  })

  it('serves exact starting contracts', async () => {
    await request(server)
      .get('/health/startup')
      .expect(503, { status: 'starting' })
    await request(server)
      .get('/health/ready')
      .expect(503, {
        status: 'unavailable',
        checks: {
          draining: 'up',
          postgresql: 'skipped',
          'redis-auth': 'skipped',
          startup: 'down',
        },
      })
  })

  it('serves ready up and down contracts', async () => {
    lifecycle.markReady()
    await request(server).get('/health/startup').expect(200, {
      status: 'ok',
    })
    await request(server)
      .get('/health/ready')
      .expect(200, {
        status: 'ok',
        checks: {
          draining: 'up',
          postgresql: 'up',
          'redis-auth': 'up',
          startup: 'up',
        },
      })
    databaseStatus = 'down'
    await request(server)
      .get('/health/ready')
      .expect(503, {
        status: 'unavailable',
        checks: {
          draining: 'up',
          postgresql: 'down',
          'redis-auth': 'up',
          startup: 'up',
        },
      })
  })

  it('keeps startup latched and rejects readiness while draining', async () => {
    lifecycle.beginDrain()
    await request(server).get('/health/startup').expect(200, {
      status: 'ok',
    })
    await request(server)
      .get('/health/ready')
      .expect(503, {
        status: 'unavailable',
        checks: {
          draining: 'down',
          postgresql: 'skipped',
          'redis-auth': 'skipped',
          startup: 'up',
        },
      })
    await request(server).get('/v1/health/ready').expect(404)
  })
})
