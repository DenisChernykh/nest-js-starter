import request from 'supertest'

import type { DocsTestHarness } from './docs-test-harness'
import { createDocsTestHarness } from './docs-test-harness'

describe('Swagger UI runtime surface', () => {
  let harness: DocsTestHarness

  beforeAll(async () => {
    harness = await createDocsTestHarness('public')
  })

  afterAll(async () => {
    await harness.app.close()
  })

  it('serves local assets and loads only the canonical JSON URL', async () => {
    const [html, init, css] = await Promise.all([
      request(harness.server).get('/docs').expect(200),
      request(harness.server).get('/docs/swagger-ui-init.js').expect(200),
      request(harness.server).get('/docs/swagger-ui.css').expect(200),
    ])

    expect(html.text).toContain('/docs/swagger-ui-init.js')
    expect(init.text).toContain('/openapi.json')
    expect(init.text).toContain('"withCredentials": true')
    expect(init.text).toContain('"persistAuthorization": false')
    expect(init.text).not.toContain('requestInterceptor')
    expect(`${html.text}${init.text}`).not.toContain('nest-js-starter-session=')
    expect(css.headers['content-type']).toMatch(/^text\/css/u)
    expect(html.text).not.toMatch(/(?:src|href)="https?:\/\//u)
  })

  it('serves JSON only at the exact canonical raw route', async () => {
    const response = await request(harness.server)
      .get('/openapi.json')
      .expect(200)

    expect(response.body).toMatchObject({
      openapi: '3.0.3',
      components: {
        securitySchemes: {
          csrfToken: {
            in: 'header',
            name: 'X-CSRF-Token',
            type: 'apiKey',
          },
        },
      },
    })
    await request(harness.server).get('/docs-json').expect(404)
    await request(harness.server).get('/docs-yaml').expect(404)
    await request(harness.server).get('/openapi.yaml').expect(404)
  })
})
