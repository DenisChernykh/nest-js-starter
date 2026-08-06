import { AuthMailDeliveryError } from '@/modules/auth/application/auth-mail-delivery.port'
import {
  NodemailerAuthMailAdapter,
  type NodemailerTransport,
} from '@/modules/auth/infrastructure/nodemailer-auth-mail.adapter'
import type { SendMailOptions } from 'nodemailer'

function harness(
  sendMail: NodemailerTransport['sendMail'] = jest.fn(() =>
    Promise.resolve({}),
  ),
): {
  readonly adapter: NodemailerAuthMailAdapter
  readonly createTransport: jest.MockedFunction<
    (url: string, options: Record<string, unknown>) => NodemailerTransport
  >
  readonly transport: NodemailerTransport & { readonly close: jest.Mock }
} {
  const close = jest.fn()
  const transport = {
    sendMail,
    close,
  }
  const createTransport = jest.fn(
    (url: string, options: Record<string, unknown>): NodemailerTransport => {
      void url
      void options
      return transport
    },
  )
  const adapter = new NodemailerAuthMailAdapter(
    {
      smtpUrl: 'smtp://mailer:secret@smtp.example.com:587',
      mailFrom: 'no-reply@example.com',
      timeoutMs: 1_500,
    },
    createTransport,
  )
  return { adapter, createTransport, transport }
}

describe('NodemailerAuthMailAdapter', () => {
  it('uses fixed safe messages, fragment URLs and disables file/URL access', async () => {
    const sendMailMock = jest.fn((options: SendMailOptions) => {
      void options
      return Promise.resolve({ messageId: 'private-id' })
    })
    const sendMail: NodemailerTransport['sendMail'] = sendMailMock
    const { adapter, createTransport } = harness(sendMail)

    await expect(
      adapter.sendEmailVerification({
        to: 'user@example.com',
        verificationUrl:
          'https://app.example.com/auth/verify-email#token=raw&<token',
      }),
    ).resolves.toEqual({ delivered: true })
    await expect(
      adapter.sendPasswordReset({
        to: 'user@example.com',
        resetUrl:
          'https://app.example.com/auth/reset-password#token=reset-token',
      }),
    ).resolves.toEqual({ delivered: true })

    expect(createTransport).toHaveBeenCalledWith(
      'smtp://mailer:secret@smtp.example.com:587',
      expect.objectContaining({
        pool: false,
        requireTLS: true,
        tls: { rejectUnauthorized: true },
      }),
    )
    const first = sendMailMock.mock.calls[0]?.[0]
    const second = sendMailMock.mock.calls[1]?.[0]
    expect(first?.from).toBe('no-reply@example.com')
    expect(first?.to).toBe('user@example.com')
    expect(first?.disableFileAccess).toBe(true)
    expect(first?.disableUrlAccess).toBe(true)
    expect(first?.text).toContain(
      'https://app.example.com/auth/verify-email#token=raw&<token',
    )
    expect(first?.html).toContain('&lt;token')
    expect(second?.from).toBe('no-reply@example.com')
    expect(second?.to).toBe('user@example.com')
    expect(second?.subject).toBe('Сброс пароля')
    expect(second?.disableFileAccess).toBe(true)
    expect(second?.disableUrlAccess).toBe(true)
  })

  it('returns a redacted typed failure and closes a timed-out transport attempt', async () => {
    jest.useFakeTimers()
    try {
      const sendMail = jest.fn(() => new Promise(() => undefined))
      const { adapter, transport } = harness(sendMail)
      const attempt = adapter
        .sendPasswordReset({
          to: 'user@example.com',
          resetUrl:
            'https://app.example.com/auth/reset-password#token=reset-token',
        })
        .catch((value: unknown) => value)
      await jest.advanceTimersByTimeAsync(1_500)
      const error = await attempt
      expect(error).toBeInstanceOf(AuthMailDeliveryError)
      expect(error).not.toHaveProperty(
        'message',
        expect.stringContaining('smtp://mailer:secret'),
      )
      expect((transport.close as jest.Mock).mock.calls).toHaveLength(1)
    } finally {
      jest.useRealTimers()
    }
  })
})
