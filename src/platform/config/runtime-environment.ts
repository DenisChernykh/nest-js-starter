import type { ObjectSchema, ValidationErrorItem } from 'joi'

import {
  RuntimeConfigurationError,
  type ApplicationRuntimeConfig,
  type DatabaseRuntimeConfig,
  type LoggingRuntimeConfig,
  type PostgresCommandRuntimeConfig,
  type RuntimeConfigurationIssue,
  type ValidatedPostgresCommandEnvironment,
  type ValidatedRuntimeEnvironment,
} from './runtime-config.types'
import {
  postgresCommandEnvironmentSchema,
  runtimeEnvironmentSchema,
} from './runtime-environment.schema'

function toIssue(detail: ValidationErrorItem): RuntimeConfigurationIssue {
  return {
    path: detail.path.length === 0 ? 'runtime' : detail.path.join('.'),
    rule: detail.type,
  }
}

function validateSchema<T>(
  schema: ObjectSchema<T>,
  input: Record<string, unknown>,
): T {
  const result = schema.validate(input, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  })
  if (result.error !== undefined) {
    throw new RuntimeConfigurationError(result.error.details.map(toIssue))
  }
  return result.value
}

function buildLoggingConfig(
  environment:
    ValidatedRuntimeEnvironment | ValidatedPostgresCommandEnvironment,
): LoggingRuntimeConfig {
  return Object.freeze({
    level: environment.LOG_LEVEL,
    serviceName: environment.OTEL_SERVICE_NAME,
    serviceVersion: environment.SERVICE_VERSION,
    serviceRevision: environment.SERVICE_REVISION,
  })
}

function buildDatabaseConfig(
  environment:
    ValidatedRuntimeEnvironment | ValidatedPostgresCommandEnvironment,
): DatabaseRuntimeConfig {
  return Object.freeze({
    url: environment.DATABASE_URL,
    poolMax: environment.DATABASE_POOL_MAX,
    connectionTimeoutMs: environment.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: environment.DATABASE_IDLE_TIMEOUT_MS,
    healthTimeoutMs: environment.DATABASE_HEALTH_TIMEOUT_MS,
    transactionMaxWaitMs: environment.DATABASE_TRANSACTION_MAX_WAIT_MS,
    transactionTimeoutMs: environment.DATABASE_TRANSACTION_TIMEOUT_MS,
  })
}

/**
 * Validates and normalizes the process environment before runtime startup.
 *
 * @param input - Untrusted environment key/value record.
 * @returns Typed normalized values for the keys owned by this runtime slice.
 * @throws RuntimeConfigurationError with redacted path/rule issues only.
 */
export function validateRuntimeEnvironment(
  input: Record<string, unknown>,
): ValidatedRuntimeEnvironment {
  return validateSchema(runtimeEnvironmentSchema, input)
}

/**
 * Builds the deeply immutable API process configuration before Nest startup.
 *
 * @param input - Untrusted process environment key/value record.
 * @returns Complete typed API configuration with defensive arrays/secrets.
 * @throws RuntimeConfigurationError with redacted path/rule issues only.
 */
export function buildApiRuntimeConfig(
  input: Record<string, unknown>,
): ApplicationRuntimeConfig {
  const environment = validateRuntimeEnvironment(input)
  const cacheUrl = environment.REDIS_CACHE_URL
  const endpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT
  const tracesEndpoint = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  const metricsEndpoint = environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT

  return Object.freeze({
    environment: environment.NODE_ENV,
    logging: buildLoggingConfig(environment),
    observability: Object.freeze({
      disabled: environment.OTEL_SDK_DISABLED,
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(tracesEndpoint === undefined ? {} : { tracesEndpoint }),
      ...(metricsEndpoint === undefined ? {} : { metricsEndpoint }),
      protocol: environment.OTEL_EXPORTER_OTLP_PROTOCOL,
      exporterTimeoutMs: environment.OTEL_EXPORTER_OTLP_TIMEOUT,
      metricExportIntervalMs: environment.OTEL_METRIC_EXPORT_INTERVAL,
      metricExportTimeoutMs: environment.OTEL_METRIC_EXPORT_TIMEOUT,
      batchSpanScheduleDelayMs: environment.OTEL_BSP_SCHEDULE_DELAY,
      batchSpanExportTimeoutMs: environment.OTEL_BSP_EXPORT_TIMEOUT,
    }),
    docs: Object.freeze({
      mode: environment.API_DOCS_MODE,
    }),
    http: Object.freeze({
      host: environment.API_HOST,
      port: environment.API_PORT,
      publicApiUrl: environment.PUBLIC_API_URL,
      corsOrigins: Object.freeze([...environment.CORS_ORIGINS]),
      trustedProxyCidrs: Object.freeze([...environment.TRUST_PROXY_CIDRS]),
      jsonBodyLimitBytes: environment.HTTP_JSON_BODY_LIMIT_BYTES,
      requestTimeoutMs: environment.HTTP_REQUEST_TIMEOUT_MS,
      headersTimeoutMs: environment.HTTP_HEADERS_TIMEOUT_MS,
      keepAliveTimeoutMs: environment.HTTP_KEEP_ALIVE_TIMEOUT_MS,
      drainTimeoutMs: environment.HTTP_DRAIN_TIMEOUT_MS,
      shutdownGraceMs: environment.SHUTDOWN_GRACE_MS,
    }),
    database: buildDatabaseConfig(environment),
    redis: Object.freeze({
      coordinationUrl: environment.REDIS_COORDINATION_URL,
      ...(cacheUrl === undefined ? {} : { cacheUrl }),
      connectTimeoutMs: environment.REDIS_CONNECT_TIMEOUT_MS,
      commandTimeoutMs: environment.REDIS_COMMAND_TIMEOUT_MS,
      healthTimeoutMs: environment.REDIS_HEALTH_TIMEOUT_MS,
      shutdownTimeoutMs: environment.REDIS_SHUTDOWN_TIMEOUT_MS,
      keyPrefix: environment.REDIS_KEY_PREFIX,
    }),
    auth: Object.freeze({
      sessionCookieName: environment.AUTH_SESSION_COOKIE_NAME,
      secureCookie: environment.AUTH_COOKIE_SECURE,
      sessionIdleTimeoutMs: environment.AUTH_SESSION_IDLE_TIMEOUT_MS,
      sessionAbsoluteTimeoutMs: environment.AUTH_SESSION_ABSOLUTE_TIMEOUT_MS,
      sessionTouchIntervalMs: environment.AUTH_SESSION_TOUCH_INTERVAL_MS,
      sessionKeySecret: new Uint8Array(environment.AUTH_SESSION_KEY_SECRET),
      csrfSecret: new Uint8Array(environment.AUTH_CSRF_SECRET),
      rateLimitKeySecret: new Uint8Array(
        environment.AUTH_RATE_LIMIT_KEY_SECRET,
      ),
      networkMetadataSecret: new Uint8Array(
        environment.AUTH_NETWORK_METADATA_SECRET,
      ),
      csrfOrigins: Object.freeze([...environment.AUTH_CSRF_ORIGINS]),
      loginIpLimit: environment.AUTH_LOGIN_IP_LIMIT,
      loginAccountLimit: environment.AUTH_LOGIN_ACCOUNT_LIMIT,
      loginWindowMs: environment.AUTH_LOGIN_WINDOW_MS,
    }),
  })
}

/** Builds the API configuration from the process-owned environment boundary. */
export function createApiRuntimeConfig(): ApplicationRuntimeConfig {
  return buildApiRuntimeConfig(process.env)
}

/**
 * Builds an immutable PostgreSQL-only command projection.
 *
 * @param input - Untrusted process environment key/value record.
 * @returns Database and logging settings without Redis/auth placeholders.
 * @throws RuntimeConfigurationError with redacted path/rule issues only.
 */
export function buildPostgresCommandConfig(
  input: Record<string, unknown>,
): PostgresCommandRuntimeConfig {
  const environment = validateSchema(postgresCommandEnvironmentSchema, input)
  return Object.freeze({
    environment: environment.NODE_ENV,
    logging: buildLoggingConfig(environment),
    database: buildDatabaseConfig(environment),
  })
}
