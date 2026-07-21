import request from 'supertest'

import { AuthenticationFailedError } from '@/modules/auth/application/auth-errors'
import {
  createAuthTestHarness,
  type AuthTestHarness,
} from '@test/e2e/auth/auth-test-harness'

describe('browser authentication contract', () => {
  let development: AuthTestHarness
  let production: AuthTestHarness

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
      session: { publicId: 'session-current' },
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

  it('rejects unknown DTO fields', async () => {
    await request(development.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .send({
        email: 'user@example.com',
        password: 'correct password',
        admin: true,
      })
      .expect(400)
  })

  it('returns the same generic failure body for unknown and wrong credentials', async () => {
    development.doubles.login.execute.mockRejectedValueOnce(
      new AuthenticationFailedError(),
    )
    const unknown = await request(development.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .send({ email: 'missing@example.com', password: 'wrong password' })
      .expect(401)
    development.doubles.login.execute.mockRejectedValueOnce(
      new AuthenticationFailedError(),
    )
    const wrong = await request(development.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .send({ email: 'user@example.com', password: 'wrong password' })
      .expect(401)
    expect(unknown.body).toEqual(wrong.body)
    expect(unknown.body).toEqual({
      code: 'AUTHENTICATION_FAILED',
      detail: 'Authentication failed',
    })
  })
})
