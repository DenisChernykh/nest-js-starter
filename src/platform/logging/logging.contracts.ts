/** Correlation identifiers attached only when a real context is active. */
export interface CorrelationFields {
  readonly requestId?: string
  readonly traceId?: string
  readonly spanId?: string
}

/** Structured log severities supported by the production sink. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/** Primitive attribute value accepted by structured records. */
export type StructuredLogAttribute = string | number | boolean

/** One validated log record before central enrichment and serialization. */
export interface StructuredLogRecord {
  readonly level: LogLevel
  readonly event: string
  readonly module: string
  readonly attributes?: Readonly<Record<string, StructuredLogAttribute>>
  readonly correlation?: CorrelationFields
  readonly error?: unknown
}

/** Framework-neutral sink used by bootstrap, platform and adapters. */
export interface StructuredLogger {
  write(record: StructuredLogRecord): void
}

/** Injection token for the framework-neutral structured logger contract. */
export const STRUCTURED_LOGGER = Symbol('STRUCTURED_LOGGER')
