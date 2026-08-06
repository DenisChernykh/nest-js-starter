import nodemailer, { type SendMailOptions } from 'nodemailer'

import {
  AuthMailDeliveryError,
  type AuthMailDeliveryPort,
} from '../application/auth-mail-delivery.port'

export interface NodemailerTransport {
  sendMail(options: SendMailOptions): Promise<unknown>
  close(): void
}

export type NodemailerTransportFactory = (
  url: string,
  options: Record<string, unknown>,
) => NodemailerTransport

export interface NodemailerAuthMailAdapterConfig {
  readonly smtpUrl: string
  readonly mailFrom: string
  readonly timeoutMs: number
}

const createDefaultTransport: NodemailerTransportFactory = (url, options) =>
  nodemailer.createTransport(url, options)

export class NodemailerAuthMailAdapter implements AuthMailDeliveryPort {
  public constructor(
    private readonly config: NodemailerAuthMailAdapterConfig,
    private readonly createTransport: NodemailerTransportFactory = createDefaultTransport,
  ) {}

  public sendEmailVerification(input: {
    readonly to: string
    readonly verificationUrl: string
  }): Promise<{ readonly delivered: boolean }> {
    return this.deliver({
      to: input.to,
      subject: 'Подтверждение электронной почты',
      text: `Подтвердите адрес электронной почты: ${input.verificationUrl}`,
      html: `<p>Подтвердите адрес электронной почты:</p><p><a href="${escapeHtml(input.verificationUrl)}">Подтвердить адрес</a></p>`,
    })
  }

  public sendPasswordReset(input: {
    readonly to: string
    readonly resetUrl: string
  }): Promise<{ readonly delivered: boolean }> {
    return this.deliver({
      to: input.to,
      subject: 'Сброс пароля',
      text: `Сбросьте пароль: ${input.resetUrl}`,
      html: `<p>Сбросьте пароль:</p><p><a href="${escapeHtml(input.resetUrl)}">Сбросить пароль</a></p>`,
    })
  }

  private async deliver(input: {
    readonly to: string
    readonly subject: string
    readonly text: string
    readonly html: string
  }): Promise<{ readonly delivered: boolean }> {
    const url = new URL(this.config.smtpUrl)
    const secure = url.protocol === 'smtps:'
    const transport = this.createTransport(this.config.smtpUrl, {
      pool: false,
      secure,
      ...(secure ? {} : { requireTLS: true }),
      connectionTimeout: this.config.timeoutMs,
      greetingTimeout: this.config.timeoutMs,
      socketTimeout: this.config.timeoutMs,
      tls: { rejectUnauthorized: true },
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        transport.sendMail({
          from: this.config.mailFrom,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
          disableFileAccess: true,
          disableUrlAccess: true,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('SMTP delivery deadline exceeded')),
            this.config.timeoutMs,
          )
        }),
      ])
      return { delivered: true }
    } catch {
      throw new AuthMailDeliveryError()
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      try {
        transport.close()
      } catch {
        // Closing a best-effort transport cannot replace its result.
      }
    }
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/gu, (character) => {
    const entities: Readonly<Record<string, string>> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character] ?? character
  })
}
