import { createClient } from 'redis'

import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'

interface LoginResult {
  readonly cookie: string
  readonly csrfToken: string
}

interface MailpitMessageSummary {
  readonly ID: string
  readonly Subject: string
}

interface MailpitMessageList {
  readonly messages: readonly MailpitMessageSummary[]
}

describe('account administration HTTP contract', () => {
  let runtime: AuthE2eRuntime
  let disabledRuntime: AuthE2eRuntime
  let coreOnlyRuntime: AuthE2eRuntime
  let failedMailRuntime: AuthE2eRuntime
  let apiUrl: string
  let disabledApiUrl: string
  let coreOnlyApiUrl: string
  let failedMailApiUrl: string

  beforeAll(async () => {
    ;[runtime, disabledRuntime, coreOnlyRuntime, failedMailRuntime] =
      await Promise.all([
        createAuthTestRuntime(1, {
          AUTH_ACCOUNT_ADMINISTRATION_MODE: 'enabled',
          AUTH_ACCOUNT_EMAIL_WORKFLOWS_MODE: 'enabled',
        }),
        createAuthTestRuntime(1),
        createAuthTestRuntime(1, {
          AUTH_ACCOUNT_ADMINISTRATION_MODE: 'enabled',
        }),
        createAuthTestRuntime(
          1,
          {
            AUTH_ACCOUNT_ADMINISTRATION_MODE: 'enabled',
            AUTH_ACCOUNT_EMAIL_WORKFLOWS_MODE: 'enabled',
          },
          { smtpFailure: true },
        ),
      ])
    apiUrl = runtime.instances[0]?.baseUrl ?? ''
    disabledApiUrl = disabledRuntime.instances[0]?.baseUrl ?? ''
    coreOnlyApiUrl = coreOnlyRuntime.instances[0]?.baseUrl ?? ''
    failedMailApiUrl = failedMailRuntime.instances[0]?.baseUrl ?? ''
  })

  afterAll(async () => {
    await Promise.all([
      runtime?.stop(),
      disabledRuntime?.stop(),
      coreOnlyRuntime?.stop(),
      failedMailRuntime?.stop(),
    ])
  })

  it('keeps account administration available while email workflows stay disabled', async () => {
    const email = `core-only-admin-${Date.now()}@example.com`
    await coreOnlyRuntime.createUser(email)
    const session = await login(coreOnlyApiUrl, email)

    expect(
      (
        await fetch(`${coreOnlyApiUrl}/v1/admin/auth/accounts`, {
          headers: { cookie: session.cookie },
        })
      ).status,
    ).toBe(200)
    const invitation = await adminMutation(
      coreOnlyApiUrl,
      '/v1/admin/auth/account-invitations',
      'POST',
      session,
      { email: 'disabled-workflow@example.com', roleKeys: [] },
    )
    expect(invitation.status).toBe(404)
    const acceptance = await postJson(
      coreOnlyApiUrl,
      '/v1/auth/account-invitations/accept',
      { token: 'A'.repeat(43), password: 'valid invited password' },
    )
    expect(acceptance.status).toBe(404)
  })

  it('hides both capabilities when their modes are disabled', async () => {
    const email = `disabled-admin-${Date.now()}@example.com`
    await disabledRuntime.createUser(email)
    const session = await login(disabledApiUrl, email)

    const protectedResponse = await fetch(
      `${disabledApiUrl}/v1/admin/auth/accounts`,
      { headers: { cookie: session.cookie } },
    )
    expect(protectedResponse.status).toBe(404)

    const publicResponse = await postJson(
      disabledApiUrl,
      '/v1/auth/account-invitations/accept',
      { token: 'A'.repeat(43), password: 'valid invited password' },
    )
    expect(publicResponse.status).toBe(404)
  })

  it('enforces auth, CSRF, strong ETags, self-lockout and Redis cleanup', async () => {
    const adminEmail = `etag-admin-${Date.now()}@example.com`
    const targetEmail = `etag-target-${Date.now()}@example.com`
    const adminId = await runtime.createUser(adminEmail)
    const targetId = await runtime.createUser(targetEmail, undefined, [])
    const admin = await login(apiUrl, adminEmail)
    const target = await login(apiUrl, targetEmail)

    expect((await fetch(`${apiUrl}/v1/admin/auth/accounts`)).status).toBe(401)

    const detail = await fetch(`${apiUrl}/v1/admin/auth/accounts/${targetId}`, {
      headers: { cookie: admin.cookie },
    })
    expect(detail.status).toBe(200)
    const etag = detail.headers.get('etag')
    expect(etag).toBe(`"account-${targetId}-0"`)

    const unsupportedMediaType = await fetch(
      `${apiUrl}/v1/admin/auth/accounts/${targetId}/status`,
      {
        method: 'PUT',
        headers: {
          cookie: admin.cookie,
          origin: apiUrl,
          'content-type': 'text/plain',
          'x-csrf-token': admin.csrfToken,
          'if-match': etag ?? '',
        },
        body: JSON.stringify({ status: 'disabled' }),
      },
    )
    expect(unsupportedMediaType.status).toBe(415)

    const withoutCsrf = await fetch(
      `${apiUrl}/v1/admin/auth/accounts/${targetId}/status`,
      {
        method: 'PUT',
        headers: {
          cookie: admin.cookie,
          origin: apiUrl,
          'content-type': 'application/json',
          'if-match': etag ?? '',
        },
        body: JSON.stringify({ status: 'disabled' }),
      },
    )
    expect(withoutCsrf.status).toBe(403)

    const missing = await adminMutation(
      apiUrl,
      `/v1/admin/auth/accounts/${targetId}/status`,
      'PUT',
      admin,
      { status: 'disabled' },
    )
    expect(missing.status).toBe(428)
    expect(await missing.json()).toMatchObject({
      code: 'AUTH_ACCOUNT_PRECONDITION_REQUIRED',
    })

    const malformed = await adminMutation(
      apiUrl,
      `/v1/admin/auth/accounts/${targetId}/status`,
      'PUT',
      admin,
      { status: 'disabled' },
      'W/"weak"',
    )
    expect(malformed.status).toBe(400)

    await expectUserSessionIndex(runtime, targetId, 1)
    const disabled = await adminMutation(
      apiUrl,
      `/v1/admin/auth/accounts/${targetId}/status`,
      'PUT',
      admin,
      { status: 'disabled' },
      etag ?? '',
    )
    expect(disabled.status).toBe(200)
    expect(disabled.headers.get('etag')).toBe(`"account-${targetId}-1"`)
    await expectUserSessionIndex(runtime, targetId, 0)
    expect(
      (
        await fetch(`${apiUrl}/v1/auth/me`, {
          headers: { cookie: target.cookie },
        })
      ).status,
    ).toBe(401)

    const stale = await adminMutation(
      apiUrl,
      `/v1/admin/auth/accounts/${targetId}/status`,
      'PUT',
      admin,
      { status: 'disabled' },
      etag ?? '',
    )
    expect(stale.status).toBe(412)

    const actorEtag = `"account-${adminId.toUpperCase()}-0"`
    const selfMutation = await adminMutation(
      apiUrl,
      `/v1/admin/auth/accounts/${adminId.toUpperCase()}/status`,
      'PUT',
      admin,
      { status: 'disabled' },
      actorEtag,
    )
    expect(selfMutation.status).toBe(403)
  })

  it('replaces roles, logs out every session and retires an account', async () => {
    const adminEmail = `lifecycle-admin-${Date.now()}@example.com`
    const targetEmail = `lifecycle-target-${Date.now()}@example.com`
    await runtime.createUser(adminEmail)
    const targetId = await runtime.createUser(targetEmail, undefined, [])
    const admin = await login(apiUrl, adminEmail)
    const target = await login(apiUrl, targetEmail)

    const initialDetail = await fetch(
      `${apiUrl}/v1/admin/auth/accounts/${targetId}`,
      { headers: { cookie: admin.cookie } },
    )
    expect(initialDetail.status).toBe(200)

    const roles = await adminMutation(
      apiUrl,
      `/v1/admin/auth/accounts/${targetId}/roles`,
      'PUT',
      admin,
      { roleKeys: ['system.admin'] },
      initialDetail.headers.get('etag') ?? '',
    )
    expect(roles.status).toBe(200)
    expect(await roles.json()).toMatchObject({
      id: targetId,
      roleKeys: ['system.admin'],
      revision: 1,
    })

    const logoutAll = await adminMutation(
      apiUrl,
      `/v1/admin/auth/accounts/${targetId}/sessions`,
      'DELETE',
      admin,
    )
    expect(logoutAll.status).toBe(204)
    expect(
      (
        await fetch(`${apiUrl}/v1/auth/me`, {
          headers: { cookie: target.cookie },
        })
      ).status,
    ).toBe(401)

    const beforeRetirement = await fetch(
      `${apiUrl}/v1/admin/auth/accounts/${targetId}`,
      { headers: { cookie: admin.cookie } },
    )
    expect(beforeRetirement.status).toBe(200)
    expect(beforeRetirement.headers.get('etag')).toBe(`"account-${targetId}-2"`)

    const retired = await adminMutation(
      apiUrl,
      `/v1/admin/auth/accounts/${targetId}`,
      'DELETE',
      admin,
      undefined,
      beforeRetirement.headers.get('etag') ?? '',
    )
    expect(retired.status).toBe(204)

    const retiredDetail = await fetch(
      `${apiUrl}/v1/admin/auth/accounts/${targetId}`,
      { headers: { cookie: admin.cookie } },
    )
    expect(retiredDetail.status).toBe(200)
    expect(await retiredDetail.json()).toMatchObject({
      id: targetId,
      email: null,
      state: 'retired',
      roleKeys: [],
      revision: 3,
    })
    const persisted = await runtime.pool.query<{
      email: string
      credentials: number
    }>(
      `SELECT u.email,
              (SELECT COUNT(*)::int FROM password_credentials pc
                WHERE pc.user_id = u.id) AS credentials
         FROM users u
        WHERE u.id = $1`,
      [targetId],
    )
    expect(persisted.rows[0]).toEqual({
      email: `retired:${targetId}`,
      credentials: 0,
    })
  })

  it('invites, accepts without a session and completes an admin reset', async () => {
    const adminEmail = `workflow-admin-${Date.now()}@example.com`
    const invitedEmail = `invited-${Date.now()}@example.com`
    await runtime.createUser(adminEmail)
    const admin = await login(apiUrl, adminEmail)

    const invitation = await adminMutation(
      apiUrl,
      '/v1/admin/auth/account-invitations',
      'POST',
      admin,
      { email: invitedEmail, roleKeys: [] },
    )
    expect(invitation.status).toBe(200)
    expect(await invitation.json()).toEqual({ mailDelivery: 'delivered' })

    const invitationMessage = await waitForMessage(
      runtime,
      'Приглашение в аккаунт',
    )
    const invitationToken = await readTokenFromMessage(
      runtime,
      invitationMessage,
      '/auth/accept-invitation',
    )
    const beforeAcceptance = await runtime.pool.query<{
      id: string
      status: string
      credential_count: string
    }>(
      `SELECT u.id, u.status, COUNT(pc.user_id)::text AS credential_count
         FROM users u
         LEFT JOIN password_credentials pc ON pc.user_id = u.id
        WHERE u.normalized_email = $1
        GROUP BY u.id`,
      [invitedEmail],
    )
    expect(beforeAcceptance.rows[0]).toMatchObject({
      status: 'INVITED',
      credential_count: '0',
    })

    const initialPassword = 'valid invited password'
    const acceptance = await postJson(
      apiUrl,
      '/v1/auth/account-invitations/accept',
      { token: invitationToken, password: initialPassword },
    )
    expect(acceptance.status).toBe(204)
    expect(acceptance.headers.get('set-cookie')).toBeNull()
    const repeated = await postJson(
      apiUrl,
      '/v1/auth/account-invitations/accept',
      { token: invitationToken, password: initialPassword },
    )
    expect(repeated.status).toBe(429)
    expect(await repeated.json()).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' })

    const invitedSession = await login(apiUrl, invitedEmail, initialPassword)
    const accountId = beforeAcceptance.rows[0]?.id
    if (accountId === undefined)
      throw new Error('Invited account was not found')
    const resetRequest = await adminMutation(
      apiUrl,
      `/v1/admin/auth/accounts/${accountId}/password-reset`,
      'POST',
      admin,
    )
    expect(resetRequest.status).toBe(200)
    expect(await resetRequest.json()).toEqual({ mailDelivery: 'delivered' })

    const resetMessage = await waitForMessage(runtime, 'Сброс пароля')
    const resetToken = await readTokenFromMessage(
      runtime,
      resetMessage,
      '/auth/reset-password',
    )
    const newPassword = 'new invited password'
    const reset = await postJson(apiUrl, '/v1/auth/password-reset/confirm', {
      token: resetToken,
      newPassword,
    })
    expect(reset.status).toBe(204)
    expect(
      (
        await fetch(`${apiUrl}/v1/auth/me`, {
          headers: { cookie: invitedSession.cookie },
        })
      ).status,
    ).toBe(401)
    await expect(
      login(apiUrl, invitedEmail, newPassword),
    ).resolves.toBeDefined()

    const duplicate = await adminMutation(
      apiUrl,
      '/v1/admin/auth/account-invitations',
      'POST',
      admin,
      { email: invitedEmail.toUpperCase(), roleKeys: [] },
    )
    expect(duplicate.status).toBe(409)
  })

  it('commits invitations before reporting an SMTP failure', async () => {
    const adminEmail = `mail-failure-admin-${Date.now()}@example.com`
    const invitedEmail = `mail-failure-${Date.now()}@example.com`
    await failedMailRuntime.createUser(adminEmail)
    const admin = await login(failedMailApiUrl, adminEmail)

    const invitation = await adminMutation(
      failedMailApiUrl,
      '/v1/admin/auth/account-invitations',
      'POST',
      admin,
      { email: invitedEmail, roleKeys: [] },
    )
    expect(invitation.status).toBe(200)
    expect(await invitation.json()).toEqual({ mailDelivery: 'failed' })
    const persisted = await failedMailRuntime.pool.query<{
      status: string
      token_count: string
    }>(
      `SELECT u.status, COUNT(ait.user_id)::text AS token_count
         FROM users u
         LEFT JOIN account_invitation_tokens ait ON ait.user_id = u.id
        WHERE u.normalized_email = $1
        GROUP BY u.id`,
      [invitedEmail],
    )
    expect(persisted.rows[0]).toEqual({
      status: 'INVITED',
      token_count: '1',
    })
  })
})

async function login(
  baseUrl: string,
  email: string,
  password = 'valid password',
): Promise<LoginResult> {
  const response = await postJson(baseUrl, '/v1/auth/login', {
    email,
    password,
  })
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  if (cookie === undefined) throw new Error('Login cookie absent')
  const body = (await response.json()) as { readonly csrfToken: string }
  return { cookie, csrfToken: body.csrfToken }
}

function postJson(
  baseUrl: string,
  path: string,
  body: Readonly<Record<string, unknown>>,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify(body),
  })
}

function adminMutation(
  baseUrl: string,
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  session: LoginResult,
  body?: Readonly<Record<string, unknown>>,
  ifMatch?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie: session.cookie,
      origin: baseUrl,
      'content-type': 'application/json',
      'x-csrf-token': session.csrfToken,
      ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function expectUserSessionIndex(
  runtime: AuthE2eRuntime,
  userId: string,
  expectedCount: number,
): Promise<void> {
  const client = createClient({
    url: runtime.redis.getConnectionUrl(),
    disableOfflineQueue: true,
    socket: { reconnectStrategy: false },
  })
  client.on('error', () => undefined)
  try {
    await client.connect()
    const keys = await client.keys(`*user-sessions*${userId}*`)
    expect(keys).toHaveLength(expectedCount)
  } finally {
    client.destroy()
  }
}

async function waitForMessage(
  runtime: AuthE2eRuntime,
  subject: string,
): Promise<MailpitMessageSummary> {
  const mailpit = runtime.mailpit
  if (mailpit === undefined) throw new Error('Mailpit is not running')
  const apiUrl = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const response = await fetch(`${apiUrl}/api/v1/messages?start=0&limit=50`)
    if (response.ok) {
      const list = (await response.json()) as MailpitMessageList
      const message = list.messages.find((item) => item.Subject === subject)
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
