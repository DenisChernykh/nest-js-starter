import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'
import {
  resumeRedis,
  suspendRedis,
} from '@test/integration/support/redis-outage'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

const execFileAsync = promisify(execFile)
const requestId = '019219c3-dc52-7cc1-9e70-f293ca14c198'

async function loginResponse(
  baseUrl: string,
  email: string,
  password: string,
): Promise<Response> {
  return fetch(`${baseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: baseUrl,
      'x-request-id': requestId,
    },
    body: JSON.stringify({ email, password }),
  })
}

describe('auth dependency failure policy', () => {
  let runtime: AuthE2eRuntime
  let baseUrl: string
  let redisSuspended = false
  let postgresStopped = false

  beforeAll(async () => {
    runtime = await createAuthTestRuntime(1)
    baseUrl = runtime.instances[0]?.baseUrl ?? ''
    await runtime.createUser('dependency@example.com')
    const disabledUserId = await runtime.createUser(
      'disabled-dependency@example.com',
    )
    await runtime.pool.query(
      "UPDATE users SET status = 'DISABLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [disabledUserId],
    )
  })

  beforeEach(async () => runtime.flushRedis())

  afterAll(async () => {
    if (runtime === undefined) return
    if (redisSuspended) await resumeRedis(runtime.redis)
    if (postgresStopped) {
      await execFileAsync('docker', ['start', runtime.postgres.getId()])
    }
    await runtime.stop()
  })

  it('keeps readiness limited to required auth dependencies', async () => {
    const readiness = await fetch(`${baseUrl}/health/ready`)
    expect(readiness.status).toBe(200)
    const body = (await readiness.json()) as {
      readonly checks: Record<string, string>
    }
    expect(body.checks).toEqual({
      draining: 'up',
      postgresql: 'up',
      'redis-auth': 'up',
      startup: 'up',
    })
    expect(
      (await loginResponse(baseUrl, 'dependency@example.com', 'valid password'))
        .status,
    ).toBe(200)
  })

  it('fails auth closed and readiness red during auth Redis loss', async () => {
    const session = await loginResponse(
      baseUrl,
      'dependency@example.com',
      'valid password',
    )
    const cookie = session.headers.get('set-cookie')?.split(';', 1)[0]
    if (cookie === undefined) throw new Error('Login cookie absent')
    await suspendRedis(runtime.redis)
    redisSuspended = true
    await waitForCondition(
      async () => (await fetch(`${baseUrl}/health/ready`)).status === 503,
      3_000,
    )
    const response = await fetch(`${baseUrl}/v1/auth/me`, {
      headers: { cookie, 'x-request-id': requestId },
    })
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toMatch(
      /^application\/problem\+json/u,
    )
    expect(await response.json()).toEqual({
      type: 'https://nest-js-starter.invalid/problems/dependency-unavailable',
      title: 'Dependency unavailable',
      status: 503,
      detail: 'A required service is temporarily unavailable.',
      instance: `urn:request:${requestId}`,
      code: 'DEPENDENCY_UNAVAILABLE',
      requestId,
    })
    await resumeRedis(runtime.redis)
    redisSuspended = false
    await waitForCondition(
      async () => (await fetch(`${baseUrl}/health/ready`)).status === 200,
      4_000,
    )
  })

  it('returns byte-equivalent missing, wrong-password and disabled failures', async () => {
    const missing = await loginResponse(
      baseUrl,
      'missing@example.com',
      'wrong password',
    )
    const wrong = await loginResponse(
      baseUrl,
      'dependency@example.com',
      'wrong password',
    )
    const disabled = await loginResponse(
      baseUrl,
      'disabled-dependency@example.com',
      'valid password',
    )
    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(disabled.status).toBe(401)
    const missingBody = await missing.text()
    expect(await wrong.text()).toBe(missingBody)
    expect(await disabled.text()).toBe(missingBody)
    expect(missing.headers.get('set-cookie')).toBeNull()
    expect(wrong.headers.get('set-cookie')).toBeNull()
    expect(disabled.headers.get('set-cookie')).toBeNull()
  })

  it('fails auth closed when PostgreSQL connections are lost', async () => {
    const session = await loginResponse(
      baseUrl,
      'dependency@example.com',
      'valid password',
    )
    const cookie = session.headers.get('set-cookie')?.split(';', 1)[0]
    if (cookie === undefined) throw new Error('Login cookie absent')
    await execFileAsync('docker', ['stop', runtime.postgres.getId()])
    postgresStopped = true
    await waitForCondition(
      async () => (await fetch(`${baseUrl}/health/ready`)).status === 503,
      3_000,
    )
    const response = await fetch(`${baseUrl}/v1/auth/me`, {
      headers: { cookie, 'x-request-id': requestId },
    })
    expect(response.status).toBe(503)
    const body = await response.text()
    expect(body).not.toContain(runtime.postgres.getConnectionUri())
    expect(body).not.toContain('postgresql://')
  })
})
