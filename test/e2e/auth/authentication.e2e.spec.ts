import request from 'supertest'

import { AuthenticationFailedError } from '@/modules/identity-access/public-contracts/auth-errors'
import {
  createAuthTestHarness,
  type AuthTestHarness,
} from '@test/e2e/auth/auth-test-harness'

describe('browser authentication contract', () => {
  let development: AuthTestHarness
  let production: AuthTestHarness
  const requestId = '019219c3-dc52-7cc1-9e70-f293ca14c198'

  beforeAll(async () => {
    ;[development, production] = await Promise.all([
      createAuthTestHarness(false),
      createAuthTestHarness(true),
    ])
  })

  afterAll(async () => {
    await Promise.all([development.app.close(), production.app.close()])
  })

  it('sets the development cookie and never returns the raw token', async () => {
    const response = await request(development.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .send({ email: 'user@example.com', password: 'correct password' })
      .expect(200)
    expect(response.headers['set-cookie']?.[0]).toContain(
      'nest-js-starter-session=',
    )
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly')
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax')
    expect(JSON.stringify(response.body)).not.toContain(development.rawToken)
    expect(response.body).toMatchObject({
      csrfToken: development.csrfToken,
      session: { publicId: 'C'.repeat(22) },
    })
  })

  it('sets the exact production host cookie flags', async () => {
    const response = await request(production.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .send({ email: 'user@example.com', password: 'correct password' })
      .expect(200)
    const cookie = response.headers['set-cookie']?.[0]
    expect(cookie).toContain('__Host-session=')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('Domain=')
  })

  it('rejects unknown DTO fields with value-free validation problems', async () => {
    const response = await request(development.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .set('X-Request-ID', requestId)
      .send({
        email: 'user@example.com',
        password: 'correct password',
        admin: true,
      })
      .expect(422)
    expect(response.body).toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      requestId,
      instance: `urn:request:${requestId}`,
      errors: [
        {
          pointer: '/admin',
          code: 'unknown_field',
          detail: 'Field is not allowed.',
        },
      ],
    })
    expect(response.headers['content-type']).toMatch(
      /^application\/problem\+json/u,
    )
  })

  it('returns the same generic failure body for unknown and wrong credentials', async () => {
    development.doubles.login.execute.mockRejectedValueOnce(
      new AuthenticationFailedError(),
    )
    const unknown = await request(development.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .set('X-Request-ID', requestId)
      .send({ email: 'missing@example.com', password: 'wrong password' })
      .expect(401)
    development.doubles.login.execute.mockRejectedValueOnce(
      new AuthenticationFailedError(),
    )
    const wrong = await request(development.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .set('X-Request-ID', requestId)
      .send({ email: 'user@example.com', password: 'wrong password' })
      .expect(401)
    expect(unknown.body).toEqual(wrong.body)
    expect(unknown.body).toEqual({
      type: 'https://nest-js-starter.invalid/problems/authentication-required',
      title: 'Authentication required',
      status: 401,
      detail: 'Valid authentication is required for this request.',
      instance: `urn:request:${requestId}`,
      code: 'AUTHENTICATION_REQUIRED',
      requestId,
    })
    expect(unknown.headers['content-type']).toMatch(
      /^application\/problem\+json/u,
    )
  })
})
