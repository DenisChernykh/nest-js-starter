import request from 'supertest'

import type { DocsTestHarness } from './docs-test-harness'
import { createDocsTestHarness } from './docs-test-harness'
import { configureApi } from '@/bootstrap/api/configure-api'
import { createOpenApiRuntimeConfig } from '@/bootstrap/contracts/openapi-runtime-config'

describe('API documentation access modes', () => {
  const harnesses: DocsTestHarness[] = []

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map(({ app }) => app.close()))
  })

  it('registers no documentation routes in off mode', async () => {
    const harness = await createDocsTestHarness('off')
    harnesses.push(harness)

    await request(harness.server).get('/docs').expect(404)
    await request(harness.server).get('/openapi.json').expect(404)
    expect(harness.authorize).not.toHaveBeenCalled()
  })

  it('serves UI and JSON in public mode without invoking policy', async () => {
    const harness = await createDocsTestHarness('public')
    harnesses.push(harness)

    await request(harness.server).get('/docs').expect(200)
    await request(harness.server).get('/docs/').expect(200)
    await request(harness.server).get('/openapi.json').expect(200)
    expect(harness.authorize).not.toHaveBeenCalled()
  })

  it.each([
    ['AUTHENTICATION_REQUIRED', 401],
    ['AUTHORIZATION_DENIED', 403],
    ['DEPENDENCY_UNAVAILABLE', 503],
  ] as const)(
    'returns protected-mode %s as RFC 9457',
    async (problemCode, status) => {
      const harness = await createDocsTestHarness('protected', {
        allowed: false,
        problemCode,
      })
      harnesses.push(harness)

      const response = await request(harness.server)
        .get('/openapi.json')
        .set('Cookie', 'nest-js-starter-session=value')
        .expect(status)

      expect(response.headers['content-type']).toMatch(
        /^application\/problem\+json/u,
      )
      expect(response.headers['x-request-id']).toBe(
        '019f0000-0000-7000-8000-000000000009',
      )
      expect(response.body).toMatchObject({
        code: problemCode,
        status,
        requestId: '019f0000-0000-7000-8000-000000000009',
      })
      expect(harness.authorize).toHaveBeenCalledWith(
        'nest-js-starter-session=value',
        expect.any(Number),
      )
      expect(harness.accessLogPaths).toEqual(['/openapi.json'])
    },
  )

  it('allows an authorized admin and protects UI descendants', async () => {
    const harness = await createDocsTestHarness('protected')
    harnesses.push(harness)

    await request(harness.server).get('/docs').expect(200)
    await request(harness.server).get('/docs/swagger-ui.css').expect(200)
    expect(harness.authorize).toHaveBeenCalledTimes(2)
  })

  it('does not claim near-miss routes in protected mode', async () => {
    const harness = await createDocsTestHarness('protected')
    harnesses.push(harness)

    await request(harness.server).get('/documentation').expect(404)
    expect(harness.authorize).not.toHaveBeenCalled()
  })

  it('wires the complete document through the real API composition root', async () => {
    const base = createOpenApiRuntimeConfig()
    const runtime = await configureApi({
      ...base,
      docs: { mode: 'public' },
      http: { ...base.http, port: 0 },
    })
    try {
      runtime.lifecycle.markReady()
      await runtime.application.listen()
      const address = runtime.application.address()
      if (address === null || typeof address === 'string') {
        throw new Error('Docs test listener address is unavailable')
      }

      const response = await request(`http://127.0.0.1:${address.port}`)
        .get('/openapi.json')
        .expect(200)
      const document = JSON.parse(response.text) as {
        readonly paths: Readonly<Record<string, unknown>>
      }
      expect(document.paths).toHaveProperty('/health/live')
      expect(document.paths).toHaveProperty('/v1/auth/login')
    } finally {
      await runtime.application.close()
    }
  })
})
