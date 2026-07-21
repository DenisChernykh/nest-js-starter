/**
 * Supported runtime deployment modes.
 */
export type RuntimeEnvironment = 'development' | 'test' | 'production'

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
 * Complete typed runtime configuration exposed to composition code.
 */
export interface ApplicationRuntimeConfig {
  readonly environment: RuntimeEnvironment
  readonly http: HttpRuntimeConfig
  readonly database: DatabaseRuntimeConfig
}

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
  readonly API_HOST: string
  readonly API_PORT: number
  readonly PUBLIC_API_URL: string
  readonly CORS_ORIGINS: readonly string[]
  readonly TRUST_PROXY_CIDRS: readonly string[]
  readonly HTTP_JSON_BODY_LIMIT_BYTES: number
  readonly HTTP_REQUEST_TIMEOUT_MS: number
  readonly HTTP_HEADERS_TIMEOUT_MS: number
  readonly HTTP_KEEP_ALIVE_TIMEOUT_MS: number
  readonly HTTP_DRAIN_TIMEOUT_MS: number
  readonly SHUTDOWN_GRACE_MS: number
  readonly DATABASE_URL: string
  readonly DATABASE_POOL_MAX: number
  readonly DATABASE_CONNECTION_TIMEOUT_MS: number
  readonly DATABASE_IDLE_TIMEOUT_MS: number
  readonly DATABASE_HEALTH_TIMEOUT_MS: number
  readonly DATABASE_TRANSACTION_MAX_WAIT_MS: number
  readonly DATABASE_TRANSACTION_TIMEOUT_MS: number
}
