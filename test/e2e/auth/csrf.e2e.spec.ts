import request from 'supertest'

import {
  createAuthTestHarness,
  type AuthTestHarness,
} from '@test/e2e/auth/auth-test-harness'

describe('browser CSRF contract', () => {
  let harness: AuthTestHarness
  let cookie: string
  const requestId = '019219c3-dc52-7cc1-9e70-f293ca14c198'

  beforeAll(async () => {
    harness = await createAuthTestHarness()
    cookie = `${harness.cookieName}=${harness.rawToken}`
  })

  afterAll(async () => harness.app.close())

  it('returns the session-bound token for an authenticated safe request', async () => {
    await request(harness.server)
      .get('/v1/auth/csrf')
      .set('Cookie', cookie)
      .expect(200, { csrfToken: harness.csrfToken })
  })

  it('rejects missing and wrong CSRF values on unsafe authenticated requests', async () => {
    const missing = await request(harness.server)
      .post('/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'application/json')
      .set('X-Request-ID', requestId)
      .expect(403)
    const wrong = await request(harness.server)
      .post('/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', 'wrong')
      .set('X-Request-ID', requestId)
      .expect(403)
    const problem = {
      type: 'https://nest-js-starter.invalid/problems/authorization-denied',
      title: 'Authorization denied',
      status: 403,
      detail: 'The authenticated principal cannot perform this request.',
      instance: `urn:request:${requestId}`,
      code: 'AUTHORIZATION_DENIED',
      requestId,
    }
    expect(missing.body).toEqual(problem)
    expect(wrong.body).toEqual(problem)
    expect(missing.headers['content-type']).toMatch(
      /^application\/problem\+json/u,
    )
  })

  it('runs authentication before the session-bound CSRF check', async () => {
    const response = await request(harness.server)
      .post('/v1/auth/logout')
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'application/json')
      .set('X-Request-ID', requestId)
      .expect(401)

    expect(response.body).toEqual({
      type: 'https://nest-js-starter.invalid/problems/authentication-required',
      title: 'Authentication required',
      status: 401,
      detail: 'Valid authentication is required for this request.',
      instance: `urn:request:${requestId}`,
      code: 'AUTHENTICATION_REQUIRED',
      requestId,
    })
  })

  it('does not exempt login from exact origin and JSON policy', async () => {
    await request(harness.server)
      .post('/v1/auth/login')
      .send({ email: 'user@example.com', password: 'correct password' })
      .expect(403)
    await request(harness.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'user@example.com', password: 'correct password' })
      .expect(403)
  })
})
