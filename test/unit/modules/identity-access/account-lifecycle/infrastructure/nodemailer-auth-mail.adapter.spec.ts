import { AuthMailDeliveryError } from '@/modules/identity-access/account-lifecycle/application/auth-mail-delivery.port'
import {
  NodemailerAuthMailAdapter,
  type NodemailerAuthMailAdapterConfig,
  type NodemailerTransportFactory,
  type NodemailerTransport,
} from '@/modules/identity-access/account-lifecycle/infrastructure/nodemailer-auth-mail.adapter'
import type { SendMailOptions } from 'nodemailer'

function harness(
  sendMail: NodemailerTransport['sendMail'] = jest.fn(() =>
    Promise.resolve({}),
  ),
  security: NodemailerAuthMailAdapterConfig['security'] = 'production',
  smtpUrl = 'smtp://mailer:secret@smtp.example.com:587',
): {
  readonly adapter: NodemailerAuthMailAdapter
  readonly createTransport: jest.MockedFunction<NodemailerTransportFactory>
  readonly transport: NodemailerTransport & { readonly close: jest.Mock }
} {
  const close = jest.fn()
  const transport = {
    sendMail,
    close,
  }
  const createTransport = jest.fn<
    NodemailerTransport,
    Parameters<NodemailerTransportFactory>
  >(() => transport)
  const adapter = new NodemailerAuthMailAdapter(
    {
      smtpUrl,
      mailFrom: 'no-reply@example.com',
      timeoutMs: 1_500,
      security,
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

    const transportOptions = createTransport.mock.calls[0]?.[0]
    expect(transportOptions).toEqual(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        pool: false,
        requireTLS: true,
        tls: { rejectUnauthorized: true },
      }),
    )
    expect(createTransport.mock.calls[0]).toHaveLength(1)
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

  it('allows plaintext only for the explicit local Mailpit policy', async () => {
    const { adapter, createTransport } = harness(
      jest.fn(() => Promise.resolve({})),
      'local',
    )

    await expect(
      adapter.sendEmailVerification({
        to: 'user@example.com',
        verificationUrl: 'http://localhost:3000/auth/verify-email#token=test',
      }),
    ).resolves.toEqual({ delivered: true })

    expect(createTransport.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        secure: false,
      }),
    )
    expect(createTransport.mock.calls[0]?.[0]).not.toHaveProperty('requireTLS')
  })

  it('passes an IPv6 SMTP literal to the transport without URL brackets', async () => {
    const { adapter, createTransport } = harness(
      jest.fn(() => Promise.resolve({})),
      'local',
      'smtp://[::1]:1025',
    )

    await expect(
      adapter.sendEmailVerification({
        to: 'user@example.com',
        verificationUrl: 'http://localhost:3000/auth/verify-email#token=test',
      }),
    ).resolves.toEqual({ delivered: true })

    expect(createTransport.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ host: '::1', port: 1025 }),
    )
  })

  it('returns a redacted typed failure and closes a timed-out transport attempt', async () => {
    jest.useFakeTimers()
    try {
      let lateDelivery = false
      let lateDeliveryTimer: ReturnType<typeof setTimeout> | undefined
      const sendMail = jest.fn(
        () =>
          new Promise(() => {
            lateDeliveryTimer = setTimeout(() => {
              lateDelivery = true
            }, 5_000)
          }),
      )
      const { adapter, transport } = harness(sendMail)
      transport.close.mockImplementation(() => {
        if (lateDeliveryTimer !== undefined) clearTimeout(lateDeliveryTimer)
      })
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
      await jest.advanceTimersByTimeAsync(5_000)
      expect(lateDelivery).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })
})
