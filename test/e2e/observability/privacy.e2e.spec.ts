import { createHash } from 'node:crypto'

import {
  createAuthTestRuntime,
  type AuthE2eRuntime,
} from '@test/e2e/support/create-auth-test-runtime'
import {
  mailpitApiUrl,
  mailpitSmtpUrl,
} from '@test/integration/support/mailpit-container'
import { waitForCondition } from '@test/integration/support/wait-for-condition'

interface MailpitMessageSummary {
  readonly ID: string
  readonly Subject: string
}

interface MailpitMessageList {
  readonly messages: readonly MailpitMessageSummary[]
}

describe('telemetry and problem privacy matrix', () => {
  let runtime: AuthE2eRuntime

  beforeAll(async () => {
    runtime = await createAuthTestRuntime(1, {
      OTEL_SDK_DISABLED: 'false',
      AUTH_SELF_SERVICE_MODE: 'open',
    })
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

  it('keeps self-service email, tokens, digests, SMTP and action URLs value-free', async () => {
    const instance = runtime.instances[0]
    const mailpit = runtime.mailpit
    if (instance === undefined || mailpit === undefined) {
      throw new Error('Expected API and Mailpit runtime')
    }
    const email = 'self-service-privacy@example.test'
    const password = 'self-service-privacy-password'
    const registration = await fetch(`${instance.baseUrl}/v1/auth/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: instance.baseUrl,
      },
      body: JSON.stringify({ email, password }),
    })
    expect(registration.status).toBe(202)
    expect(await registration.text()).toBe('')

    const apiUrl = mailpitApiUrl(mailpit)
    let message: MailpitMessageSummary | undefined
    await waitForCondition(async () => {
      const response = await fetch(`${apiUrl}/api/v1/messages?start=0&limit=50`)
      if (!response.ok) return false
      const list = (await response.json()) as MailpitMessageList
      message = list.messages.find(
        (candidate) => candidate.Subject === 'Подтверждение электронной почты',
      )
      return message !== undefined
    }, 8_000)
    if (message === undefined) throw new Error('Expected privacy message')

    const messageUrl = `${apiUrl}/api/v1/message/${encodeURIComponent(message.ID)}/raw`
    const mailResponse = await fetch(messageUrl)
    if (!mailResponse.ok) throw new Error('Expected privacy raw message')
    const mail = decodeQuotedPrintable(await mailResponse.text())
    const tokenMatch = mail.match(
      /(https?:\/\/[^\s]+\/auth\/verify-email#token=[A-Za-z0-9_-]{43})/u,
    )
    if (tokenMatch?.[1] === undefined) {
      throw new Error('Expected verification action URL')
    }
    const actionUrl = tokenMatch[1]
    const rawToken = actionUrl.split('#token=', 2)[1]
    if (rawToken === undefined) throw new Error('Expected raw token')
    const invalidToken = `${rawToken.slice(0, -1)}${
      rawToken.endsWith('A') ? 'B' : 'A'
    }`
    const tokenDigest = createHash('sha256')
      .update(invalidToken, 'utf8')
      .digest('base64url')
    const smtpUrl = mailpitSmtpUrl(mailpit)
    const problemResponse = await fetch(
      `${instance.baseUrl}/v1/auth/email-verification/confirm`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: instance.baseUrl,
        },
        body: JSON.stringify({ token: invalidToken }),
      },
    )
    const problem: unknown = await problemResponse.json()
    expect(problemResponse.status).toBe(400)
    expect(problem).toMatchObject({ code: 'AUTH_TOKEN_INVALID_OR_EXPIRED' })
    expect(problem).toHaveProperty('requestId')
    expect(mail).toContain(actionUrl)

    const serialized = JSON.stringify(problem) + instance.output()
    for (const forbidden of [
      email,
      password,
      rawToken,
      tokenDigest,
      smtpUrl,
      actionUrl,
      messageUrl,
      runtime.postgres.getConnectionUri(),
      runtime.redis.getConnectionUrl(),
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})

function decodeQuotedPrintable(value: string): string {
  return value
    .replaceAll(/=\r?\n/gu, '')
    .replaceAll(/=([0-9A-F]{2})/gu, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
}
