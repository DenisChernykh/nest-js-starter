import { Inject, Injectable, type LoggerService } from '@nestjs/common'

import {
  STRUCTURED_LOGGER,
  type LogLevel,
  type StructuredLogAttribute,
  type StructuredLogger,
} from './logging.contracts'
import { sanitizeLogText } from './safe-error.serializer'

const validContext = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u

function messageType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'Array'
  if (typeof value !== 'object') return typeof value
  const constructorName = value.constructor?.name
  return typeof constructorName === 'string' &&
    validContext.test(constructorName)
    ? constructorName
    : 'Object'
}

function contextFrom(optionalParams: readonly unknown[]): string {
  const candidate = optionalParams.at(-1)
  return typeof candidate === 'string' && validContext.test(candidate)
    ? candidate
    : 'Nest'
}

/** Adapts Nest system messages to finite structured records without HTTP logs. */
@Injectable()
export class NestLoggerAdapter implements LoggerService {
  public constructor(
    @Inject(STRUCTURED_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  /** Maps a Nest informational message. */
  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', 'nest_log', message, optionalParams)
  }

  /** Maps a Nest fatal message. */
  public fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', 'nest_fatal', message, optionalParams)
  }

  /** Maps a Nest error without accepting a raw stack string. */
  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', 'nest_error', message, optionalParams)
  }

  /** Maps a Nest warning message. */
  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', 'nest_warn', message, optionalParams)
  }

  /** Maps a Nest debug message. */
  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', 'nest_debug', message, optionalParams)
  }

  /** Maps a Nest verbose message to trace severity. */
  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('trace', 'nest_verbose', message, optionalParams)
  }

  private write(
    level: LogLevel,
    event: string,
    message: unknown,
    optionalParams: readonly unknown[],
  ): void {
    const module = contextFrom(optionalParams)
    if (message instanceof Error) {
      this.logger.write({ level, event, module, error: message })
      return
    }

    const attributes: Readonly<Record<string, StructuredLogAttribute>> =
      typeof message === 'string'
        ? { message: sanitizeLogText(message) }
        : { messageType: messageType(message) }
    this.logger.write({ level, event, module, attributes })
  }
}
