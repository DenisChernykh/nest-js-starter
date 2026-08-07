import { createClient } from 'redis'

import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'

interface LoginResult {
  readonly cookie: string
  readonly csrfToken: string
}

describe('account administration HTTP contract', () => {
  let runtime: AuthE2eRuntime
  let disabledRuntime: AuthE2eRuntime
  let apiUrl: string
  let disabledApiUrl: string

  beforeAll(async () => {
    ;[runtime, disabledRuntime] = await Promise.all([
      createAuthTestRuntime(1, {
        AUTH_ACCOUNT_ADMINISTRATION_MODE: 'enabled',
      }),
      createAuthTestRuntime(1),
    ])
    apiUrl = runtime.instances[0]?.baseUrl ?? ''
    disabledApiUrl = disabledRuntime.instances[0]?.baseUrl ?? ''
  })

  afterAll(async () => {
    await Promise.all([runtime?.stop(), disabledRuntime?.stop()])
  })

  it('hides account administration when its mode is disabled', async () => {
    const email = `disabled-admin-${Date.now()}@example.com`
    await disabledRuntime.createUser(email)
    const session = await login(disabledApiUrl, email)

    const protectedResponse = await fetch(
      `${disabledApiUrl}/v1/admin/auth/accounts`,
      { headers: { cookie: session.cookie } },
    )
    expect(protectedResponse.status).toBe(404)
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
      email: `retired+${targetId}@invalid.local`,
      credentials: 0,
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
