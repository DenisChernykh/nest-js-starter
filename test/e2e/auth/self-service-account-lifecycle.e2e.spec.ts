import request from 'supertest'
import type { Pool } from 'pg'

import { AuthTokenInvalidOrExpiredError } from '@/modules/auth/application/self-service-auth.policy'
import { EmailVerificationRequiredError } from '@/modules/auth/application/auth-errors'
import {
  createAuthTestHarness,
  type AuthTestHarness,
} from '@test/e2e/auth/auth-test-harness'
import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'

interface MailpitMessageSummary {
  readonly ID: string
  readonly Subject: string
}

interface MailpitMessageList {
  readonly messages: readonly MailpitMessageSummary[]
}

describe('self-service account lifecycle HTTP contract', () => {
  let auth: AuthTestHarness

  beforeAll(async () => {
    auth = await createAuthTestHarness()
  })

  afterAll(async () => {
    await auth.app.close()
  })

  it('exposes five guarded operations with empty accepted bodies', async () => {
    const acceptedRequests = [
      request(auth.server)
        .post('/v1/auth/register')
        .set('Origin', 'https://app.example.com')
        .send({ email: 'new@example.com', password: 'new secure password' })
        .expect(202),
      request(auth.server)
        .post('/v1/auth/email-verification/resend')
        .set('Origin', 'https://app.example.com')
        .send({ email: 'new@example.com' })
        .expect(202),
      request(auth.server)
        .post('/v1/auth/password-reset/request')
        .set('Origin', 'https://app.example.com')
        .send({ email: 'new@example.com' })
        .expect(202),
    ]
    const accepted = await Promise.all(acceptedRequests)

    expect(accepted.map(({ text }) => text)).toEqual(['', '', ''])
    const registerInput = auth.doubles.register.execute.mock.calls[0]?.[0]
    expect(registerInput).toMatchObject({
      email: 'new@example.com',
      password: 'new secure password',
    })
    expect(registerInput).toHaveProperty('ipAddress')
    expect(registerInput).toHaveProperty('now')
    expect(auth.doubles.resendVerification.execute).toHaveBeenCalled()
    expect(auth.doubles.requestPasswordReset.execute).toHaveBeenCalled()
    expect(auth.doubles.responseDelay.wait).toHaveBeenCalledTimes(3)

    const confirmations = await Promise.all([
      request(auth.server)
        .post('/v1/auth/email-verification/confirm')
        .set('Origin', 'https://app.example.com')
        .send({ token: 'A'.repeat(43) })
        .expect(204),
      request(auth.server)
        .post('/v1/auth/password-reset/confirm')
        .set('Origin', 'https://app.example.com')
        .send({ token: 'B'.repeat(43), newPassword: 'new secure password' })
        .expect(204),
    ])

    expect(confirmations.map(({ text }) => text)).toEqual(['', ''])
    const verificationInput =
      auth.doubles.confirmVerification.execute.mock.calls[0]?.[0]
    expect(verificationInput).toMatchObject({ token: 'A'.repeat(43) })
    expect(verificationInput).toHaveProperty('now')
    const resetInput =
      auth.doubles.confirmPasswordReset.execute.mock.calls[0]?.[0]
    expect(resetInput).toMatchObject({
      token: 'B'.repeat(43),
      newPassword: 'new secure password',
    })
    expect(resetInput).toHaveProperty('now')
  })

  it('preserves origin and JSON policy and validates DTOs', async () => {
    await request(auth.server)
      .post('/v1/auth/register')
      .send({ email: 'new@example.com', password: 'new secure password' })
      .expect(403)

    const invalid = await request(auth.server)
      .post('/v1/auth/register')
      .set('Origin', 'https://app.example.com')
      .send({ email: 'invalid', password: 'short' })
      .expect(422)
    expect(invalid.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
    })
  })

  it('maps explicit lifecycle problems without structural code matching', async () => {
    auth.doubles.confirmVerification.execute.mockRejectedValueOnce(
      new AuthTokenInvalidOrExpiredError(),
    )
    const tokenFailure = await request(auth.server)
      .post('/v1/auth/email-verification/confirm')
      .set('Origin', 'https://app.example.com')
      .send({ token: 'A'.repeat(43) })
      .expect(400)
    expect(tokenFailure.body).toMatchObject({
      code: 'AUTH_TOKEN_INVALID_OR_EXPIRED',
      status: 400,
    })

    auth.doubles.login.execute.mockRejectedValueOnce(
      new EmailVerificationRequiredError(),
    )
    const verificationFailure = await request(auth.server)
      .post('/v1/auth/login')
      .set('Origin', 'https://app.example.com')
      .send({ email: 'new@example.com', password: 'new secure password' })
      .expect(403)
    expect(verificationFailure.body).toMatchObject({
      code: 'EMAIL_VERIFICATION_REQUIRED',
      status: 403,
    })
    expect(verificationFailure.headers['set-cookie']).toBeUndefined()
  })
})

describe('self-service account lifecycle real flow', () => {
  let runtime: AuthE2eRuntime
  let disabledRuntime: AuthE2eRuntime
  let apiUrl: string
  let pool: Pool

  beforeAll(async () => {
    runtime = await createAuthTestRuntime(1, {
      AUTH_SELF_SERVICE_MODE: 'open',
    })
    disabledRuntime = await createAuthTestRuntime(1)
    apiUrl = runtime.instances[0]?.baseUrl ?? ''
    pool = runtime.pool
  })

  afterAll(async () => {
    await Promise.all([runtime?.stop(), disabledRuntime?.stop()])
  })

  it('registers, verifies, logs in, resets and invalidates the old session', async () => {
    const email = `lifecycle-${Date.now()}@example.com`
    const initialPassword = 'initial secure password'
    const resetPassword = 'reset secure password'

    const registration = await postJson(apiUrl, '/v1/auth/register', {
      email,
      password: initialPassword,
    })
    expect(registration.status).toBe(202)
    expect(await registration.text()).toBe('')

    const persisted = await readUserState(pool, email)
    expect(persisted.status).toBe('ACTIVE')
    expect(persisted.emailVerifiedAt).toBeNull()
    expect(persisted.roleCount).toBe(0)
    expect(persisted.credentialHash).toBeTruthy()

    const verificationMessage = await waitForMessage(
      runtime,
      'Подтверждение электронной почты',
    )
    const verificationToken = await readTokenFromMessage(
      runtime,
      verificationMessage,
      '/auth/verify-email',
    )

    const unverifiedLogin = await postJson(apiUrl, '/v1/auth/login', {
      email,
      password: initialPassword,
    })
    expect(unverifiedLogin.status).toBe(403)
    expect(await unverifiedLogin.json()).toMatchObject({
      code: 'EMAIL_VERIFICATION_REQUIRED',
      status: 403,
    })
    expect(unverifiedLogin.headers.get('set-cookie')).toBeNull()

    const beforeDuplicate = await readUserState(pool, email)
    const duplicate = await postJson(apiUrl, '/v1/auth/register', {
      email: email.toUpperCase(),
      password: 'different secure password',
    })
    expect(duplicate.status).toBe(202)
    expect(await duplicate.text()).toBe('')
    const afterDuplicate = await readUserState(pool, email)
    expect(afterDuplicate).toEqual(beforeDuplicate)

    const verification = await postJson(
      apiUrl,
      '/v1/auth/email-verification/confirm',
      { token: verificationToken },
    )
    expect(verification.status).toBe(204)
    const repeatedVerification = await postJson(
      apiUrl,
      '/v1/auth/email-verification/confirm',
      { token: verificationToken },
    )
    expect(repeatedVerification.status).toBe(400)
    expect(await repeatedVerification.json()).toMatchObject({
      code: 'AUTH_TOKEN_INVALID_OR_EXPIRED',
      status: 400,
    })

    const login = await postJson(apiUrl, '/v1/auth/login', {
      email,
      password: initialPassword,
    })
    expect(login.status).toBe(200)
    const sessionCookie = login.headers.get('set-cookie')?.split(';', 1)[0]
    expect(sessionCookie).toBeDefined()
    const me = await fetch(`${apiUrl}/v1/auth/me`, {
      headers: { Cookie: sessionCookie ?? '' },
    })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ roleKeys: [], permissions: [] })

    const unknownReset = await postJson(
      apiUrl,
      '/v1/auth/password-reset/request',
      { email: 'missing-account@example.com' },
    )
    expect(unknownReset.status).toBe(202)
    expect(await unknownReset.text()).toBe('')

    const resetRequest = await postJson(
      apiUrl,
      '/v1/auth/password-reset/request',
      { email },
    )
    expect(resetRequest.status).toBe(202)
    expect(await resetRequest.text()).toBe('')
    const resetMessage = await waitForMessage(runtime, 'Сброс пароля')
    const resetToken = await readTokenFromMessage(
      runtime,
      resetMessage,
      '/auth/reset-password',
    )

    const reset = await postJson(apiUrl, '/v1/auth/password-reset/confirm', {
      token: resetToken,
      newPassword: resetPassword,
    })
    expect(reset.status).toBe(204)
    const repeatedReset = await postJson(
      apiUrl,
      '/v1/auth/password-reset/confirm',
      { token: resetToken, newPassword: 'another secure password' },
    )
    expect(repeatedReset.status).toBe(400)
    expect(await repeatedReset.json()).toMatchObject({
      code: 'AUTH_TOKEN_INVALID_OR_EXPIRED',
      status: 400,
    })

    const oldSession = await fetch(`${apiUrl}/v1/auth/me`, {
      headers: { Cookie: sessionCookie ?? '' },
    })
    expect(oldSession.status).toBe(401)
    const newLogin = await postJson(apiUrl, '/v1/auth/login', {
      email,
      password: resetPassword,
    })
    expect(newLogin.status).toBe(200)
  })

  it('keeps disabled reset requests generic without a token transition', async () => {
    const disabledEmail = `disabled-${Date.now()}@example.com`
    const userId = await runtime.createUser(disabledEmail)
    await pool.query('UPDATE users SET status = $1 WHERE id = $2', [
      'DISABLED',
      userId,
    ])
    const before = await readUserState(pool, disabledEmail)

    const response = await postJson(apiUrl, '/v1/auth/password-reset/request', {
      email: disabledEmail,
    })
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    expect(await readUserState(pool, disabledEmail)).toEqual(before)
  })

  it('rotates verification messages and accepts only the newest token', async () => {
    const email = `resend-${Date.now()}@example.com`
    const registration = await postJson(apiUrl, '/v1/auth/register', {
      email,
      password: 'resend secure password',
    })
    expect(registration.status).toBe(202)
    expect(await registration.text()).toBe('')

    const firstMessage = await waitForMessage(
      runtime,
      'Подтверждение электронной почты',
    )
    const firstToken = await readTokenFromMessage(
      runtime,
      firstMessage,
      '/auth/verify-email',
    )
    const resend = await postJson(
      apiUrl,
      '/v1/auth/email-verification/resend',
      { email },
    )
    expect(resend.status).toBe(202)
    expect(await resend.text()).toBe('')

    const newestMessage = await waitForMessage(
      runtime,
      'Подтверждение электронной почты',
      new Set([firstMessage.ID]),
    )
    expect(newestMessage.ID).not.toBe(firstMessage.ID)
    const newestToken = await readTokenFromMessage(
      runtime,
      newestMessage,
      '/auth/verify-email',
    )
    const oldConfirmation = await postJson(
      apiUrl,
      '/v1/auth/email-verification/confirm',
      { token: firstToken },
    )
    expect(oldConfirmation.status).toBe(400)
    const newConfirmation = await postJson(
      apiUrl,
      '/v1/auth/email-verification/confirm',
      { token: newestToken },
    )
    expect(newConfirmation.status).toBe(204)
  })

  it('gives unknown and eligible reset requests the same accepted floor', async () => {
    const eligibleEmail = `timing-${Date.now()}@example.com`
    await runtime.createUser(eligibleEmail)
    const unknown = await timedPostJson(
      apiUrl,
      '/v1/auth/password-reset/request',
      { email: `missing-${eligibleEmail}` },
    )
    const eligible = await timedPostJson(
      apiUrl,
      '/v1/auth/password-reset/request',
      { email: eligibleEmail },
    )

    for (const result of [unknown, eligible]) {
      expect(result.response.status).toBe(202)
      expect(await result.response.text()).toBe('')
      expect(result.durationMs).toBeGreaterThanOrEqual(1_900)
    }
  })

  it('returns a dependency problem during Redis suspension without account mutation', async () => {
    const email = `redis-outage-${Date.now()}@example.com`
    await runtime.createUser(email)
    const before = await readUserState(pool, email)
    const resumeRedis = await runtime.suspendRedis()
    try {
      const response = await postJson(
        apiUrl,
        '/v1/auth/password-reset/request',
        { email },
      )
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        status: 503,
      })
      expect(await readUserState(pool, email)).toEqual(before)
    } finally {
      await resumeRedis()
    }
  })

  it('keeps self-service disabled while existing verified login remains available', async () => {
    const disabledApiUrl = disabledRuntime.instances[0]?.baseUrl ?? ''
    const email = `existing-${Date.now()}@example.com`
    await disabledRuntime.createUser(email)

    const registration = await postJson(disabledApiUrl, '/v1/auth/register', {
      email: `new-${email}`,
      password: 'new secure password',
    })
    expect(registration.status).toBe(404)
    expect(await registration.json()).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })

    const login = await postJson(disabledApiUrl, '/v1/auth/login', {
      email,
      password: 'valid password',
    })
    expect(login.status).toBe(200)
  })
})

async function postJson(
  apiUrl: string,
  path: string,
  body: Readonly<Record<string, string>>,
): Promise<Response> {
  return fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: apiUrl,
    },
    body: JSON.stringify(body),
  })
}

async function readUserState(
  pool: Pool,
  email: string,
): Promise<{
  readonly status: string
  readonly emailVerifiedAt: Date | null
  readonly credentialHash: string | null
  readonly roleCount: number
  readonly passwordResetTokenDigest: string | null
}> {
  const result = await pool.query<{
    status: string
    email_verified_at: Date | null
    password_hash: string | null
    role_count: string
    password_reset_token_digest: string | null
  }>(
    `SELECT u.status, u.email_verified_at, pc.password_hash,
            COUNT(ur.role_key)::text AS role_count,
            MAX(prt.token_digest)::text AS password_reset_token_digest
       FROM users u
       LEFT JOIN password_credentials pc ON pc.user_id = u.id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN password_reset_tokens prt ON prt.user_id = u.id
      WHERE u.normalized_email = $1
      GROUP BY u.id, pc.password_hash`,
    [email.trim().toLowerCase()],
  )
  const row = result.rows[0]
  if (row === undefined) throw new Error('Expected self-service user row')
  return {
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    credentialHash: row.password_hash,
    roleCount: Number(row.role_count),
    passwordResetTokenDigest: row.password_reset_token_digest,
  }
}

async function timedPostJson(
  apiUrl: string,
  path: string,
  body: Readonly<Record<string, string>>,
): Promise<{ readonly response: Response; readonly durationMs: number }> {
  const startedAt = performance.now()
  const response = await postJson(apiUrl, path, body)
  return { response, durationMs: performance.now() - startedAt }
}

async function waitForMessage(
  runtime: AuthE2eRuntime,
  subject: string,
  excludedMessageIds: ReadonlySet<string> = new Set(),
): Promise<MailpitMessageSummary> {
  const mailpit = runtime.mailpit
  if (mailpit === undefined) throw new Error('Mailpit is not running')
  const apiUrl = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const response = await fetch(`${apiUrl}/api/v1/messages?start=0&limit=50`)
    if (response.ok) {
      const list = (await response.json()) as MailpitMessageList
      const message = list.messages.find(
        (item) => item.Subject === subject && !excludedMessageIds.has(item.ID),
      )
      if (message !== undefined) return message
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Mailpit message not observed: ${subject}`)
}

async function readTokenFromMessage(
  runtime: AuthE2eRuntime,
  message: MailpitMessageSummary,
  path: string,
): Promise<string> {
  const mailpit = runtime.mailpit
  if (mailpit === undefined) throw new Error('Mailpit is not running')
  const apiUrl = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`
  const response = await fetch(
    `${apiUrl}/api/v1/message/${encodeURIComponent(message.ID)}/raw`,
  )
  if (!response.ok) throw new Error('Mailpit raw message unavailable')
  const raw = decodeQuotedPrintable(await response.text())
  const match = raw.match(new RegExp(`${path}#token=([A-Za-z0-9_-]{43})`, 'u'))
  if (match?.[1] === undefined) throw new Error('Mail token not captured')
  return match[1]
}

function decodeQuotedPrintable(value: string): string {
  return value
    .replaceAll(/=\r?\n/gu, '')
    .replaceAll(/=([0-9A-F]{2})/gu, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
}
