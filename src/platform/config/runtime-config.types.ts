/**
 * Supported runtime deployment modes.
 */
export type RuntimeEnvironment = 'development' | 'test' | 'production'

/** Supported runtime exposure policies for generated API documentation. */
export type ApiDocsMode = 'off' | 'public' | 'protected'

/** Immutable API documentation exposure policy. */
export interface ApiDocsRuntimeConfig {
  readonly mode: ApiDocsMode
}

/** Logging levels that may be emitted by the production JSON sink. */
export type RuntimeLogLevel =
  'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/** Immutable service identity and base logger policy. */
export interface LoggingRuntimeConfig {
  readonly level: RuntimeLogLevel
  readonly serviceName: string
  readonly serviceVersion: string
  readonly serviceRevision: string
}

/** Immutable OpenTelemetry SDK and OTLP trace exporter settings. */
export interface OpenTelemetryRuntimeConfig {
  readonly disabled: boolean
  readonly endpoint?: string
  readonly exporterTimeoutMs: number
  readonly batchSpanScheduleDelayMs: number
  readonly batchSpanExportTimeoutMs: number
}

/**
 * Immutable HTTP listener, origin and deadline settings.
 */
export interface HttpRuntimeConfig {
  readonly host: string
  readonly port: number
  readonly publicApiUrl: string
  readonly corsOrigins: readonly string[]
  readonly trustedProxyCidrs: readonly string[]
  readonly jsonBodyLimitBytes: number
  readonly requestTimeoutMs: number
  readonly headersTimeoutMs: number
  readonly keepAliveTimeoutMs: number
  readonly drainTimeoutMs: number
  readonly shutdownGraceMs: number
}

/**
 * Immutable PostgreSQL pool, health and transaction deadline settings.
 */
export interface DatabaseRuntimeConfig {
  readonly url: string
  readonly poolMax: number
  readonly connectionTimeoutMs: number
  readonly idleTimeoutMs: number
  readonly healthTimeoutMs: number
  readonly transactionMaxWaitMs: number
  readonly transactionTimeoutMs: number
}

/**
 * Immutable auth Redis URL, optional queue URL and bounded lifecycle deadlines.
 */
export interface RedisRuntimeConfig {
  readonly authUrl: string
  readonly queueUrl?: string
  readonly connectTimeoutMs: number
  readonly commandTimeoutMs: number
  readonly healthTimeoutMs: number
  readonly shutdownTimeoutMs: number
  readonly keyPrefix: string
}

/** Immutable queue URL and bounded lifecycle settings for one BullMQ context. */
export interface QueueRuntimeConfig {
  readonly redisUrl: string
  readonly connectTimeoutMs: number
  readonly healthTimeoutMs: number
  readonly shutdownGraceMs: number
}

/**
 * Immutable browser-auth policy and owned cryptographic key material.
 *
 * @remarks Secret byte arrays returned by the config service are defensive
 * copies. Mutating one caller's copy cannot alter later configuration reads.
 */
export interface AuthRuntimeConfig {
  readonly sessionCookieName: string
  readonly secureCookie: boolean
  readonly sessionIdleTimeoutMs: number
  readonly sessionAbsoluteTimeoutMs: number
  readonly sessionTouchIntervalMs: number
  readonly sessionKeySecret: Uint8Array
  readonly csrfSecret: Uint8Array
  readonly rateLimitKeySecret: Uint8Array
  readonly networkMetadataSecret: Uint8Array
  readonly csrfOrigins: readonly string[]
  readonly loginIpLimit: number
  readonly loginAccountLimit: number
  readonly loginWindowMs: number
}

/**
 * Complete typed runtime configuration exposed to composition code.
 */
export interface ApplicationRuntimeConfig {
  readonly environment: RuntimeEnvironment
  readonly logging: LoggingRuntimeConfig
  readonly observability: OpenTelemetryRuntimeConfig
  readonly docs: ApiDocsRuntimeConfig
  readonly http: HttpRuntimeConfig
  readonly database: DatabaseRuntimeConfig
  readonly redis: RedisRuntimeConfig
  readonly auth: AuthRuntimeConfig
}

/** PostgreSQL-only process projection without HTTP, Redis or auth settings. */
export interface PostgresCommandRuntimeConfig {
  readonly environment: RuntimeEnvironment
  readonly logging: LoggingRuntimeConfig
  readonly database: DatabaseRuntimeConfig
}

/** Injection token for one prevalidated immutable API runtime config. */
export const APPLICATION_RUNTIME_CONFIG = Symbol('APPLICATION_RUNTIME_CONFIG')

/**
 * Non-secret configuration projection safe for startup diagnostics.
 */
export interface SafeRuntimeConfigSummary {
  readonly environment: RuntimeEnvironment
  readonly apiHost: string
  readonly apiPort: number
  readonly publicApiOrigin: string
  readonly corsOriginCount: number
  readonly trustedProxyCount: number
  readonly databasePoolMax: number
  readonly redisAuthConfigured: boolean
  readonly redisQueueConfigured: boolean
  readonly authCookieName: string
}

/**
 * One redacted validation issue identified only by key path and rule.
 */
export interface RuntimeConfigurationIssue {
  readonly path: string
  readonly rule: string
}

/**
 * Deterministic startup error that never retains rejected environment values.
 */
export class RuntimeConfigurationError extends Error {
  public readonly issues: readonly RuntimeConfigurationIssue[]

  /**
   * Creates a stable, redacted validation error.
   *
   * @param issues - Key paths and validation rule identifiers without values.
   */
  public constructor(issues: readonly RuntimeConfigurationIssue[]) {
    const sortedIssues = [...issues].sort((left, right) =>
      `${left.path}:${left.rule}`.localeCompare(`${right.path}:${right.rule}`),
    )
    super(
      `Invalid runtime configuration: ${sortedIssues
        .map((issue) => `${issue.path} (${issue.rule})`)
        .join(', ')}`,
    )
    this.name = 'RuntimeConfigurationError'
    this.issues = Object.freeze(sortedIssues)
  }
}

/**
 * Normalized environment-key representation produced by the single schema.
 */
export interface ValidatedRuntimeEnvironment {
  readonly NODE_ENV: RuntimeEnvironment
  readonly API_DOCS_MODE: ApiDocsMode
  readonly LOG_LEVEL: RuntimeLogLevel
  readonly OTEL_SERVICE_NAME: string
  readonly SERVICE_VERSION: string
  readonly SERVICE_REVISION: string
  readonly OTEL_SDK_DISABLED: boolean
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string
  readonly API_HOST: string
  readonly API_PORT: number
  readonly PUBLIC_API_URL: string
  readonly CORS_ORIGINS: readonly string[]
  readonly TRUST_PROXY_CIDRS: readonly string[]
  readonly DATABASE_URL: string
  readonly DATABASE_POOL_MAX: number
  readonly REDIS_AUTH_URL: string
  readonly REDIS_QUEUE_URL?: string
  readonly REDIS_KEY_PREFIX: string
  readonly AUTH_SESSION_KEY_SECRET: Uint8Array
  readonly AUTH_CSRF_SECRET: Uint8Array
  readonly AUTH_RATE_LIMIT_KEY_SECRET: Uint8Array
  readonly AUTH_NETWORK_METADATA_SECRET: Uint8Array
}

/** Minimal normalized environment accepted by a standalone queue worker. */
export interface ValidatedQueueWorkerEnvironment {
  readonly REDIS_QUEUE_URL: string
}

/** Normalized environment keys accepted by a PostgreSQL-only command. */
export interface ValidatedPostgresCommandEnvironment {
  readonly NODE_ENV: RuntimeEnvironment
  readonly LOG_LEVEL: RuntimeLogLevel
  readonly OTEL_SERVICE_NAME: string
  readonly SERVICE_VERSION: string
  readonly SERVICE_REVISION: string
  readonly DATABASE_URL: string
  readonly DATABASE_POOL_MAX: number
}
