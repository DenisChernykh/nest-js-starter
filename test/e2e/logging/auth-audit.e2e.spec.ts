import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

describe('auth security audit records', () => {
  let runtime: AuthE2eRuntime
  let baseUrl: string

  beforeAll(async () => {
    runtime = await createAuthTestRuntime(1)
    baseUrl = runtime.instances[0]?.baseUrl ?? ''
    await runtime.createUser('audit@example.com')
    const unverifiedUserId = await runtime.createUser(
      'unverified-audit@example.com',
    )
    await runtime.pool.query(
      'UPDATE users SET email_verified_at = NULL WHERE id = $1',
      [unverifiedUserId],
    )
  })

  afterAll(async () => runtime.stop())

  it('emits correlated success and value-free denied login events', async () => {
    const deniedRequestId = '019219c3-dc52-7cc1-9e70-f293ca14c198'
    const denied = await login(
      'missing@example.com',
      'private-password',
      deniedRequestId,
    )
    expect(denied.status).toBe(401)
    const deniedRecord = await waitForAudit('INVALID_CREDENTIALS')
    expect(deniedRecord).toMatchObject({
      kind: 'audit',
      action: 'login',
      outcome: 'denied',
      reasonCode: 'INVALID_CREDENTIALS',
      requestId: deniedRequestId,
    })
    expect(deniedRecord).not.toHaveProperty('actorId')
    expect(deniedRecord).not.toHaveProperty('sessionId')

    const successRequestId = '019219c3-dc52-7cc1-9e70-f293ca14c199'
    const success = await login(
      'audit@example.com',
      'valid password',
      successRequestId,
    )
    expect(success.status).toBe(200)
    const successRecord = await waitForAudit('LOGIN_SUCCEEDED')
    expect(successRecord).toMatchObject({
      kind: 'audit',
      action: 'login',
      outcome: 'success',
      reasonCode: 'LOGIN_SUCCEEDED',
      requestId: successRequestId,
      targetType: 'session',
    })
    expect(successRecord).toHaveProperty('actorId')
    expect(successRecord).toHaveProperty('sessionId')

    const serialized = JSON.stringify([deniedRecord, successRecord])
    for (const forbidden of [
      'audit@example.com',
      'missing@example.com',
      'private-password',
      'valid password',
      'ipAddress',
      'cookie',
      'url',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('commits registration before SMTP failure and emits a partial value-free audit', async () => {
    const outage = await createAuthTestRuntime(
      1,
      { AUTH_SELF_SERVICE_MODE: 'open' },
      { smtpFailure: true },
    )
    try {
      const instance = outage.instances[0]
      if (instance === undefined) throw new Error('Expected one API instance')
      const email = `smtp-outage-${Date.now()}@example.com`
      const password = 'smtp-outage-password'
      const response = await fetch(`${instance.baseUrl}/v1/auth/register`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: instance.baseUrl,
        },
        body: JSON.stringify({ email, password }),
      })
      expect(response.status).toBe(202)
      expect(await response.text()).toBe('')

      const persisted = await outage.pool.query<{
        token_digest: string | null
      }>(
        `SELECT evt.token_digest
           FROM email_verification_tokens evt
           JOIN users u ON u.id = evt.user_id
          WHERE u.normalized_email = $1`,
        [email],
      )
      const tokenDigest = persisted.rows[0]?.token_digest
      expect(tokenDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)

      let partial: Record<string, unknown> | undefined
      await waitForCondition(() => {
        const output = instance.output()
        partial = output
          .split('\n')
          .flatMap((line) => {
            try {
              const parsed: unknown = JSON.parse(line)
              return isRecord(parsed) && parsed['kind'] === 'audit'
                ? [parsed]
                : []
            } catch {
              return []
            }
          })
          .find(
            (record) =>
              record['action'] === 'email_verification_send' &&
              record['outcome'] === 'partial',
          )
        return Promise.resolve(partial !== undefined)
      }, 8_000)
      expect(partial).toMatchObject({
        action: 'email_verification_send',
        outcome: 'partial',
        reasonCode: 'MAIL_DELIVERY_FAILED',
      })
      const output = instance.output()
      const forbiddenValues = [email, password, 'smtp://127.0.0.1:1']
      if (tokenDigest !== undefined && tokenDigest !== null) {
        forbiddenValues.push(tokenDigest)
      }
      for (const forbidden of forbiddenValues) {
        expect(output).not.toContain(forbidden)
      }
    } finally {
      await outage.stop()
    }
  })

  it('keeps the unverified-login audit event and does not issue a session', async () => {
    const requestId = '019219c3-dc52-7cc1-9e70-f293ca14c200'
    const response = await login(
      'unverified-audit@example.com',
      'valid password',
      requestId,
    )
    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
    const record = await waitForAudit('EMAIL_VERIFICATION_REQUIRED')
    expect(record).toMatchObject({
      kind: 'audit',
      action: 'login',
      outcome: 'denied',
      reasonCode: 'EMAIL_VERIFICATION_REQUIRED',
      requestId,
    })
    const output = runtime.instances[0]?.output() ?? ''
    for (const forbidden of [
      'unverified-audit@example.com',
      'valid password',
      'token',
    ]) {
      expect(output).not.toContain(forbidden)
    }
  })

  async function login(
    email: string,
    password: string,
    requestId: string,
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

  async function waitForAudit(
    reasonCode: string,
  ): Promise<Record<string, unknown>> {
    let found: Record<string, unknown> | undefined
    await waitForCondition(() => {
      found = auditRecords().find(
        (record) => record['reasonCode'] === reasonCode,
      )
      return Promise.resolve(found !== undefined)
    }, 3_000)
    if (found === undefined) throw new Error('Expected auth audit record')
    return found
  }

  function auditRecords(): Record<string, unknown>[] {
    const output = runtime.instances[0]?.output() ?? ''
    const records: Record<string, unknown>[] = []
    for (const line of output.split('\n')) {
      try {
        const parsed: unknown = JSON.parse(line)
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          'kind' in parsed &&
          parsed.kind === 'audit'
        ) {
          records.push(parsed)
        }
      } catch {
        // Nest startup output is intentionally not part of the JSON audit stream.
      }
    }
    return records
  }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
