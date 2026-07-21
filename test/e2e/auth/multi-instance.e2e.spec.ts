import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'

interface LoginResult {
  readonly cookie: string
  readonly csrfToken: string
  readonly publicId: string
}

async function login(
  baseUrl: string,
  email: string,
  password = 'valid password',
): Promise<LoginResult> {
  const response = await fetch(`${baseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  })
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  if (cookie === undefined) throw new Error('Login cookie absent')
  const body = (await response.json()) as {
    readonly csrfToken: string
    readonly session: { readonly publicId: string }
  }
  return { cookie, csrfToken: body.csrfToken, publicId: body.session.publicId }
}

async function authenticatedStatus(
  baseUrl: string,
  cookie: string,
): Promise<number> {
  return (await fetch(`${baseUrl}/v1/auth/me`, { headers: { cookie } })).status
}

async function unsafeRequest(
  baseUrl: string,
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  session: LoginResult,
  body?: object,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie: session.cookie,
      origin: baseUrl,
      'content-type': 'application/json',
      'x-csrf-token': session.csrfToken,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('multi-instance browser authentication', () => {
  let runtime: AuthE2eRuntime
  let apiA: string
  let apiB: string

  beforeAll(async () => {
    runtime = await createAuthTestRuntime(2, {
      AUTH_LOGIN_IP_LIMIT: '100',
      AUTH_LOGIN_ACCOUNT_LIMIT: '2',
    })
    ;[apiA, apiB] = runtime.instances.map(({ baseUrl }) => baseUrl) as [
      string,
      string,
    ]
  })

  beforeEach(async () => runtime.flushRedis())
  afterAll(async () => runtime.stop())

  it('authenticates on B a session issued on A and shares revoke-one', async () => {
    const email = 'cross-instance@example.com'
    await runtime.createUser(email)
    const session = await login(apiA, email)

    expect(await authenticatedStatus(apiB, session.cookie)).toBe(200)
    const revoked = await unsafeRequest(
      apiB,
      `/v1/auth/sessions/${session.publicId}`,
      'DELETE',
      session,
    )
    expect(revoked.status).toBe(204)
    expect(await authenticatedStatus(apiA, session.cookie)).toBe(401)
  })

  it('invalidates sessions from both instances after logout-all', async () => {
    const email = 'logout-all@example.com'
    await runtime.createUser(email)
    const first = await login(apiA, email)
    const second = await login(apiB, email)

    const response = await unsafeRequest(
      apiB,
      '/v1/auth/sessions',
      'DELETE',
      second,
    )
    expect(response.status).toBe(200)
    expect(await authenticatedStatus(apiA, first.cookie)).toBe(401)
    expect(await authenticatedStatus(apiB, second.cookie)).toBe(401)
  })

  it('invalidates both instances after password change', async () => {
    const email = 'password-change@example.com'
    await runtime.createUser(email)
    const first = await login(apiA, email)
    const second = await login(apiB, email)

    const changed = await unsafeRequest(
      apiB,
      '/v1/auth/password',
      'PUT',
      second,
      {
        currentPassword: 'valid password',
        newPassword: 'new valid password',
      },
    )
    expect(changed.status).toBe(200)
    expect(await authenticatedStatus(apiA, first.cookie)).toBe(401)
    expect(await authenticatedStatus(apiB, second.cookie)).toBe(401)
    await runtime.flushRedis()
    await expect(
      login(apiA, email, 'new valid password'),
    ).resolves.toBeDefined()
  })

  it('applies status, role, generation and global epoch changes on the next request', async () => {
    const statusEmail = 'status-change@example.com'
    const statusUser = await runtime.createUser(statusEmail)
    const statusSession = await login(apiA, statusEmail)
    await runtime.pool.query(
      "UPDATE users SET status = 'DISABLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [statusUser],
    )
    expect(await authenticatedStatus(apiB, statusSession.cookie)).toBe(401)

    const roleEmail = 'role-change@example.com'
    const roleUser = await runtime.createUser(roleEmail)
    const roleSession = await login(apiA, roleEmail)
    await runtime.pool.query(
      'UPDATE user_roles SET role_key = $1 WHERE user_id = $2',
      ['future.unknown', roleUser],
    )
    expect(await authenticatedStatus(apiB, roleSession.cookie)).toBe(401)

    const generationEmail = 'generation-change@example.com'
    const generationUser = await runtime.createUser(generationEmail)
    const generationSession = await login(apiA, generationEmail)
    await runtime.pool.query(
      'UPDATE users SET session_generation = session_generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [generationUser],
    )
    expect(await authenticatedStatus(apiB, generationSession.cookie)).toBe(401)

    const epochEmail = 'epoch-change@example.com'
    await runtime.createUser(epochEmail)
    const epochSession = await login(apiA, epochEmail)
    await runtime.pool.query(
      'UPDATE auth_security_state SET global_session_epoch = global_session_epoch + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
    )
    expect(await authenticatedStatus(apiB, epochSession.cookie)).toBe(401)
  })

  it('shares one atomic account limit across concurrent instance requests', async () => {
    const email = 'rate-limit@example.com'
    await runtime.createUser(email)
    const statuses = await Promise.all(
      [apiA, apiB, apiA, apiB].map(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: baseUrl },
          body: JSON.stringify({ email, password: 'valid password' }),
        })
        return response.status
      }),
    )

    expect(statuses.filter((status) => status === 200)).toHaveLength(2)
    expect(statuses.filter((status) => status === 429)).toHaveLength(2)
  })
})
