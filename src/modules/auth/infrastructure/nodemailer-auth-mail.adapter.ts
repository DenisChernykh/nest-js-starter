import { Socket } from 'node:net'

import nodemailer, { type SendMailOptions } from 'nodemailer'
import type * as SMTPTransport from 'nodemailer/lib/smtp-transport'

import {
  AuthMailDeliveryError,
  type AuthMailDeliveryPort,
} from '../application/auth-mail-delivery.port'

export interface NodemailerTransport {
  sendMail(options: SendMailOptions): Promise<unknown>
  close(): void
}

export type NodemailerTransportOptions = SMTPTransport.Options & {
  readonly pool: false
}

export type NodemailerTransportFactory = (
  options: NodemailerTransportOptions,
) => NodemailerTransport

export type NodemailerAuthMailSecurity = 'local' | 'production'

export interface NodemailerAuthMailAdapterConfig {
  readonly smtpUrl: string
  readonly mailFrom: string
  readonly timeoutMs: number
  readonly security: NodemailerAuthMailSecurity
}

const createDefaultTransport: NodemailerTransportFactory = (options) => {
  const sockets = new Set<Socket>()
  const host = options.host ?? 'localhost'
  const port = options.port ?? (options.secure ? 465 : 587)
  const getSocket = (
    _transportOptions: SMTPTransport.Options,
    callback: (
      error: Error | null,
      socketOptions?: { readonly connection: Socket },
    ) => void,
  ): void => {
    const socket = new Socket()
    let completed = false
    sockets.add(socket)
    const onConnectionError = (error: Error): void => {
      if (completed) return
      completed = true
      callback(error)
    }
    socket.once('error', onConnectionError)
    socket.once('close', () => {
      sockets.delete(socket)
      if (completed) return
      completed = true
      socket.removeListener('error', onConnectionError)
      callback(new Error('SMTP socket closed before connection'))
    })
    socket.once('connect', () => {
      if (completed) return
      completed = true
      socket.removeListener('error', onConnectionError)
      socket.setKeepAlive(true)
      callback(null, { connection: socket })
    })
    socket.connect(port, host)
  }
  const transporterOptions: NodemailerTransportOptions = {
    ...options,
    getSocket,
  }
  const transporter = nodemailer.createTransport(transporterOptions)
  return {
    sendMail: (mailOptions) => transporter.sendMail(mailOptions),
    close: () => {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      transporter.close()
    },
  }
}

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
    let transport: NodemailerTransport | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let closed = false
    const closeAttempt = (): void => {
      if (closed) return
      closed = true
      closeTransport(transport)
    }
    try {
      const url = new URL(this.config.smtpUrl)
      const secure = url.protocol === 'smtps:'
      const username = decodeUrlComponent(url.username)
      const password = decodeUrlComponent(url.password)
      transport = this.createTransport({
        host: url.hostname,
        port: url.port === '' ? (secure ? 465 : 587) : Number(url.port),
        secure,
        pool: false,
        ...(secure || this.config.security === 'local'
          ? {}
          : { requireTLS: true }),
        connectionTimeout: this.config.timeoutMs,
        greetingTimeout: this.config.timeoutMs,
        socketTimeout: this.config.timeoutMs,
        tls: { rejectUnauthorized: true },
        ...(username === '' && password === ''
          ? {}
          : { auth: { user: username, pass: password } }),
      })
      const delivery = transport.sendMail({
        from: this.config.mailFrom,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
      await Promise.race([
        delivery,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            closeAttempt()
            reject(new Error('SMTP delivery deadline exceeded'))
          }, this.config.timeoutMs)
        }),
      ])
      return { delivered: true }
    } catch {
      throw new AuthMailDeliveryError()
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      closeAttempt()
    }
  }
}

function decodeUrlComponent(value: string): string {
  return decodeURIComponent(value)
}

function closeTransport(transport: NodemailerTransport | undefined): void {
  if (transport === undefined) return
  try {
    transport.close()
  } catch {
    // Closing a best-effort transport cannot replace its result.
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
