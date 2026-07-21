import request from 'supertest'

import {
  createAuthTestHarness,
  type AuthTestHarness,
} from '@test/e2e/auth/auth-test-harness'

describe('browser CSRF contract', () => {
  let harness: AuthTestHarness
  let cookie: string

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
    await request(harness.server)
      .post('/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'application/json')
      .expect(403, { code: 'AUTH_CSRF_REJECTED', detail: 'Request rejected' })
    await request(harness.server)
      .post('/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', 'wrong')
      .expect(403, { code: 'AUTH_CSRF_REJECTED', detail: 'Request rejected' })
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
