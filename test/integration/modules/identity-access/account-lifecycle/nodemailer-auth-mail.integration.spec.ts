import { createServer, Socket } from 'node:net'

import {
  mailpitApiUrl,
  mailpitSmtpUrl,
  startMailpitContainer,
  type StartedMailpitContainer,
} from '@test/integration/support/mailpit-container'
import { AuthMailDeliveryError } from '@/modules/identity-access/account-lifecycle/application/auth-mail-delivery.port'
import { NodemailerAuthMailAdapter } from '@/modules/identity-access/account-lifecycle/infrastructure/nodemailer-auth-mail.adapter'

interface MailpitMessageSummary {
  readonly ID: string
  readonly To: readonly (string | { readonly Address?: string })[]
  readonly Subject: string
}

interface MailpitMessageList {
  readonly messages: readonly MailpitMessageSummary[]
}

describe('Nodemailer auth mail delivery against Mailpit', () => {
  let container: StartedMailpitContainer
  let apiUrl: string

  beforeAll(async () => {
    container = await startMailpitContainer()
    apiUrl = mailpitApiUrl(container)
  })

  afterAll(async () => {
    await container?.stop()
  })

  it('delivers verification and reset messages with fragment links', async () => {
    const adapter = new NodemailerAuthMailAdapter({
      smtpUrl: mailpitSmtpUrl(container),
      mailFrom: 'no-reply@example.com',
      timeoutMs: 1_500,
      security: 'local',
    })

    await expect(
      adapter.sendEmailVerification({
        to: 'verify@example.com',
        verificationUrl:
          'https://app.example.com/auth/verify-email#token=verification-token',
      }),
    ).resolves.toEqual({ delivered: true })
    await expect(
      adapter.sendPasswordReset({
        to: 'reset@example.com',
        resetUrl:
          'https://app.example.com/auth/reset-password#token=reset-token',
      }),
    ).resolves.toEqual({ delivered: true })

    const response = await fetch(`${apiUrl}/api/v1/messages?start=0&limit=50`)
    expect(response.ok).toBe(true)
    const list = (await response.json()) as MailpitMessageList
    expect(list.messages).toHaveLength(2)

    const messages = await Promise.all(
      list.messages.map(async (summary) => {
        const rawResponse = await fetch(
          `${apiUrl}/api/v1/message/${encodeURIComponent(summary.ID)}/raw`,
        )
        expect(rawResponse.ok).toBe(true)
        return {
          summary,
          raw: decodeQuotedPrintable(await rawResponse.text()),
        }
      }),
    )

    const verification = messages.find(
      ({ summary }) => summary.Subject === 'Подтверждение электронной почты',
    )
    const reset = messages.find(
      ({ summary }) => summary.Subject === 'Сброс пароля',
    )
    expect(mailRecipients(verification?.summary)).toContain(
      'verify@example.com',
    )
    expect(verification?.raw).toContain(
      'https://app.example.com/auth/verify-email#token=verification-token',
    )
    expect(verification?.raw).toContain('verify@example.com')
    expect(mailRecipients(reset?.summary)).toContain('reset@example.com')
    expect(reset?.raw).toContain(
      'https://app.example.com/auth/reset-password#token=reset-token',
    )
    expect(reset?.raw).toContain('reset@example.com')
  })

  it('fails production smtp safely when STARTTLS is unavailable', async () => {
    const server = createServer((socket) => {
      socket.write('220 test.smtp.local ESMTP\r\n')
      socket.on('data', (chunk: Buffer) => {
        if (/EHLO|HELO/iu.test(chunk.toString('ascii'))) {
          socket.write('250 test.smtp.local\r\n')
        }
      })
    })
    const port = await listen(server)
    try {
      const adapter = new NodemailerAuthMailAdapter({
        smtpUrl: `smtp://127.0.0.1:${port}`,
        mailFrom: 'no-reply@example.com',
        timeoutMs: 500,
        security: 'production',
      })

      await expect(
        adapter.sendEmailVerification({
          to: 'recipient@example.com',
          verificationUrl:
            'https://app.example.com/auth/verify-email#token=test',
        }),
      ).rejects.toBeInstanceOf(AuthMailDeliveryError)
    } finally {
      await closeServer(server)
    }
  })

  it('destroys the real SMTP socket before a longer transport timeout', async () => {
    let peerClosed = false
    const server = createServer((socket) => {
      socket.write('220 test.smtp.local ESMTP\r\n')
      socket.on('data', (chunk: Buffer) => {
        if (/EHLO|HELO/iu.test(chunk.toString('ascii'))) {
          socket.write('250 test.smtp.local\r\n')
        }
      })
      socket.once('close', () => {
        peerClosed = true
      })
    })
    const port = await listen(server)
    const originalSetTimeout: Socket['setTimeout'] = Reflect.get(
      Socket.prototype,
      'setTimeout',
    )
    const socketTimeout = jest
      .spyOn(Socket.prototype, 'setTimeout')
      .mockImplementation(function (
        this: Socket,
        _timeout: number,
        callback?: () => void,
      ): Socket {
        return callback === undefined
          ? originalSetTimeout.call(this, 5_000)
          : originalSetTimeout.call(this, 5_000, callback)
      })
    try {
      const adapter = new NodemailerAuthMailAdapter({
        smtpUrl: `smtp://127.0.0.1:${port}`,
        mailFrom: 'no-reply@example.com',
        timeoutMs: 100,
        security: 'local',
      })

      await expect(
        adapter.sendPasswordReset({
          to: 'recipient@example.com',
          resetUrl: 'https://app.example.com/auth/reset-password#token=test',
        }),
      ).rejects.toBeInstanceOf(AuthMailDeliveryError)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(peerClosed).toBe(true)
    } finally {
      socketTimeout.mockRestore()
      await closeServer(server)
    }
  })
})

async function listen(
  server: ReturnType<typeof createServer>,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP server address')
  }
  return address.port
}

async function closeServer(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  })
}

function mailRecipients(summary: MailpitMessageSummary | undefined): string {
  return (summary?.To ?? [])
    .map((recipient) =>
      typeof recipient === 'string' ? recipient : (recipient.Address ?? ''),
    )
    .join(',')
}

function decodeQuotedPrintable(value: string): string {
  return value
    .replaceAll(/=\r?\n/gu, '')
    .replaceAll(/=([0-9A-F]{2})/gu, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
}
