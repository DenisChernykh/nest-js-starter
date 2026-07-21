import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

describe('production telemetry correlation', () => {
  let runtime: AuthE2eRuntime

  beforeAll(async () => {
    runtime = await createAuthTestRuntime(1, { OTEL_SDK_DISABLED: 'false' })
  })

  afterAll(async () => runtime.stop())

  it('shares request and incoming trace identifiers across problem and logs', async () => {
    const instance = runtime.instances[0]
    if (instance === undefined) throw new Error('Expected one API instance')
    const requestId = '019219c3-dc52-7cc1-9e70-f293ca14c198'
    const traceId = '0af7651916cd43dd8448eb211c80319c'
    const response = await fetch(`${instance.baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: instance.baseUrl,
        traceparent: `00-${traceId}-b7ad6b7169203331-01`,
        'x-request-id': requestId,
      },
      body: JSON.stringify({
        email: 'missing@example.test',
        password: 'private-password',
      }),
    })
    const problem: unknown = await response.json()

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBe(requestId)
    expect(problem).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      requestId,
      instance: `urn:request:${requestId}`,
    })
    await waitForCondition(() => {
      const current = records(instance.output()).filter(
        (record) => record['requestId'] === requestId,
      )
      return Promise.resolve(
        current.some((record) => record['event'] === 'auth_audit') &&
          current.some(
            (record) => record['event'] === 'http_request_completed',
          ),
      )
    }, 3_000)
    const correlated = records(instance.output()).filter(
      (record) => record['requestId'] === requestId,
    )
    expect(
      correlated.some((record) => record['event'] === 'http_request_completed'),
    ).toBe(true)
    expect(
      correlated.some(
        (record) =>
          record['traceId'] === traceId && typeof record['spanId'] === 'string',
      ),
    ).toBe(true)
  })
})

function records(output: string): Readonly<Record<string, unknown>>[] {
  const result: Readonly<Record<string, unknown>>[] = []
  for (const line of output.split('\n')) {
    try {
      const value: unknown = JSON.parse(line)
      if (isRecord(value)) result.push(value)
    } catch {
      // Nest startup lines are outside the structured logging contract.
    }
  }
  return result
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
