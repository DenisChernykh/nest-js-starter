import request from 'supertest'

import {
  createAuthTestHarness,
  type AuthTestHarness,
} from '@test/e2e/auth/auth-test-harness'

describe('browser session management contract', () => {
  let harness: AuthTestHarness
  let cookie: string

  beforeAll(async () => {
    harness = await createAuthTestHarness()
    cookie = `${harness.cookieName}=${harness.rawToken}`
  })

  afterAll(async () => harness.app.close())

  it('lists only safe session metadata and marks the current session', async () => {
    const response = await request(harness.server)
      .get('/v1/auth/sessions')
      .set('Cookie', cookie)
      .expect(200)
    expect(response.body).toEqual({
      sessions: [
        expect.objectContaining({
          publicId: 'session-current',
          current: true,
          deviceLabel: 'test browser',
        }),
      ],
    })
    expect(JSON.stringify(response.body)).not.toContain(harness.rawToken)
  })

  it('revokes one owned public session identifier', async () => {
    const otherSessionId = 'C'.repeat(22)
    await request(harness.server)
      .delete(`/v1/auth/sessions/${otherSessionId}`)
      .set('Cookie', cookie)
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', harness.csrfToken)
      .expect(204)
    expect(harness.doubles.revokeSession.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      otherSessionId,
    )
  })

  it('clears the cookie on logout and logout-all', async () => {
    const logout = await request(harness.server)
      .post('/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', harness.csrfToken)
      .expect(204)
    expect(logout.headers['set-cookie']?.[0]).toContain(
      'nest-js-starter-session=;',
    )

    const logoutAll = await request(harness.server)
      .delete('/v1/auth/sessions')
      .set('Cookie', cookie)
      .set('Origin', 'https://app.example.com')
      .set('Content-Type', 'application/json')
      .set('X-CSRF-Token', harness.csrfToken)
      .expect(200, { cleanupComplete: true })
    expect(logoutAll.headers['set-cookie']?.[0]).toContain(
      'nest-js-starter-session=;',
    )
  })
})
