import {
  mailpitApiUrl,
  mailpitSmtpUrl,
  startMailpitContainer,
  type StartedMailpitContainer,
} from '@test/integration/support/mailpit-container'
import { NodemailerAuthMailAdapter } from '@/modules/auth/infrastructure/nodemailer-auth-mail.adapter'

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
})

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
