import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

describe('telemetry and problem privacy matrix', () => {
  let runtime: AuthE2eRuntime

  beforeAll(async () => {
    runtime = await createAuthTestRuntime(1, { OTEL_SDK_DISABLED: 'false' })
  })

  afterAll(async () => runtime.stop())

  it('keeps credentials, headers, query and dependency URLs out of output', async () => {
    const instance = runtime.instances[0]
    if (instance === undefined) throw new Error('Expected one API instance')
    const requestId = '019219c3-dc52-7cc1-9e70-f293ca14c199'
    const secrets = {
      email: 'privacy-email@example.test',
      password: 'privacy-password',
      cookie: 'privacy-cookie',
      csrf: 'privacy-csrf',
      query: 'privacy-query',
    }
    const response = await fetch(
      `${instance.baseUrl}/v1/auth/login?token=${secrets.query}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `session=${secrets.cookie}`,
          origin: instance.baseUrl,
          'x-csrf-token': secrets.csrf,
          'x-request-id': requestId,
        },
        body: JSON.stringify({
          email: secrets.email,
          password: secrets.password,
        }),
      },
    )
    const problem: unknown = await response.json()

    expect(response.status).toBe(401)
    expect(problem).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      requestId,
    })
    await waitForCondition(
      () =>
        Promise.resolve(
          instance.output().includes(`"requestId":"${requestId}"`),
        ),
      3_000,
    )
    const serialized = JSON.stringify(problem) + instance.output()
    for (const forbidden of [
      ...Object.values(secrets),
      runtime.postgres.getConnectionUri(),
      runtime.redis.getConnectionUrl(),
      'url.full',
      'http.url',
      'request.body',
      'request.query',
      'exception.message',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
