import pino, { type DestinationStream, type Logger } from 'pino'

import type { ApplicationRuntimeConfig } from '@/platform/config/runtime-config.types'

import type {
  CorrelationFields,
  LogLevel,
  StructuredLogAttribute,
  StructuredLogger,
  StructuredLogRecord,
} from './logging.contracts'
import { sanitizeLogText, serializeSafeError } from './safe-error.serializer'

const validEvent = /^[a-z][a-z0-9_.-]{0,127}$/u
const validModule = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u
const validAttribute = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u
const validLevels = new Set<LogLevel>([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
])
const reservedAttributes = new Set([
  'environment',
  'event',
  'level',
  'module',
  'requestId',
  'revision',
  'service',
  'spanId',
  'timestamp',
  'traceId',
  'version',
])
const sensitiveAttributes = new Set([
  'apikey',
  'authorization',
  'cookie',
  'databaseurl',
  'password',
  'redisurl',
  'secret',
  'setcookie',
  'token',
])
const correlationPatterns = {
  requestId: /^[A-Za-z0-9-]{1,64}$/u,
  traceId: /^[a-f0-9]{32}$/u,
  spanId: /^[a-f0-9]{16}$/u,
} as const

/** Injectable effects for deterministic Pino sink tests and correlation. */
export interface PinoLogSinkOptions {
  readonly destination?: DestinationStream
  readonly now?: () => Date
  readonly correlationFields?: () => CorrelationFields
}

function normalizedSensitiveKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '')
}

function sanitizeAttributes(
  attributes: StructuredLogRecord['attributes'],
): Readonly<Record<string, StructuredLogAttribute>> {
  if (attributes === undefined) return {}
  if (attributes === null || typeof attributes !== 'object') {
    throw new Error(
      'Invalid structured log record: attributes must be an object',
    )
  }

  const result: Record<string, StructuredLogAttribute> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (!validAttribute.test(key) || reservedAttributes.has(key)) {
      throw new Error('Invalid structured log record: invalid attribute key')
    }
    if (sensitiveAttributes.has(normalizedSensitiveKey(key))) continue
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw new Error('Invalid structured log record: non-primitive attribute')
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Invalid structured log record: non-finite attribute')
    }
    result[key] = typeof value === 'string' ? sanitizeLogText(value) : value
  }
  return result
}

function safeCorrelation(
  fields: CorrelationFields,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const key of ['requestId', 'traceId', 'spanId'] as const) {
    const value = fields[key]
    if (value !== undefined && correlationPatterns[key].test(value)) {
      result[key] = value
    }
  }
  return result
}

/** Direct newline-delimited JSON sink with central validation and redaction. */
export class PinoLogSink implements StructuredLogger {
  private readonly logger: Logger
  private readonly correlationFields: () => CorrelationFields

  public constructor(
    config: Pick<ApplicationRuntimeConfig, 'environment' | 'logging'>,
    options: PinoLogSinkOptions = {},
  ) {
    const now = options.now ?? (() => new Date())
    this.correlationFields = options.correlationFields ?? (() => ({}))
    this.logger = pino(
      {
        level: config.logging.level,
        base: {
          service: config.logging.serviceName,
          version: config.logging.serviceVersion,
          revision: config.logging.serviceRevision,
          environment: config.environment,
        },
        timestamp: () => `,"timestamp":"${now().toISOString()}"`,
        formatters: { level: (label) => ({ level: label }) },
        serializers: { error: serializeSafeError },
        redact: {
          paths: [
            'authorization',
            'cookie',
            'password',
            'token',
            'apiKey',
            'databaseUrl',
            'redisUrl',
            'secret',
          ],
          remove: true,
        },
      },
      options.destination,
    )
  }

  /** Validates, enriches and synchronously publishes one JSON record. */
  public write(record: StructuredLogRecord): void {
    if (
      !validLevels.has(record.level) ||
      !validEvent.test(record.event) ||
      !validModule.test(record.module)
    ) {
      throw new Error('Invalid structured log record: event or module')
    }

    const payload = {
      ...sanitizeAttributes(record.attributes),
      ...safeCorrelation(this.correlationFields()),
      event: record.event,
      module: record.module,
      ...(record.error === undefined ? {} : { error: record.error }),
    }
    this.publish(record.level, payload)
  }

  private publish(level: LogLevel, payload: object): void {
    switch (level) {
      case 'trace':
        this.logger.trace(payload)
        return
      case 'debug':
        this.logger.debug(payload)
        return
      case 'info':
        this.logger.info(payload)
        return
      case 'warn':
        this.logger.warn(payload)
        return
      case 'error':
        this.logger.error(payload)
        return
      case 'fatal':
        this.logger.fatal(payload)
    }
  }
}
