import type { ObjectSchema, ValidationErrorItem } from 'joi'

import {
  RuntimeConfigurationError,
  type ApplicationRuntimeConfig,
  type DatabaseRuntimeConfig,
  type LoggingRuntimeConfig,
  type PostgresCommandRuntimeConfig,
  type OutboxRelayRuntimeConfig,
  type QueueRuntimeConfig,
  type RuntimeConfigurationIssue,
  type ValidatedPostgresCommandEnvironment,
  type ValidatedOutboxRelayEnvironment,
  type ValidatedQueueWorkerEnvironment,
  type ValidatedRuntimeEnvironment,
} from './runtime-config.types'
import { runtimeDefaults } from './runtime-defaults'
import {
  postgresCommandEnvironmentSchema,
  outboxRelayEnvironmentSchema,
  queueWorkerEnvironmentSchema,
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
    ...runtimeDefaults.database,
  })
}

function buildQueueRuntimeConfig(
  environment:
    ValidatedQueueWorkerEnvironment | ValidatedOutboxRelayEnvironment,
): QueueRuntimeConfig {
  return Object.freeze({
    redisUrl: environment.REDIS_QUEUE_URL,
    ...runtimeDefaults.queue,
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
  const endpoint = environment.OTEL_EXPORTER_OTLP_ENDPOINT
  const csrfOrigins = [
    ...new Set([...environment.CORS_ORIGINS, environment.PUBLIC_API_URL]),
  ]
  const production = environment.NODE_ENV === 'production'

  return Object.freeze({
    environment: environment.NODE_ENV,
    logging: buildLoggingConfig(environment),
    observability: Object.freeze({
      disabled: environment.OTEL_SDK_DISABLED,
      ...(endpoint === undefined ? {} : { endpoint }),
      ...runtimeDefaults.observability,
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
      ...runtimeDefaults.http,
    }),
    database: buildDatabaseConfig(environment),
    redis: Object.freeze({
      authUrl: environment.REDIS_AUTH_URL,
      ...(environment.REDIS_QUEUE_URL === undefined
        ? {}
        : { queueUrl: environment.REDIS_QUEUE_URL }),
      ...runtimeDefaults.redis,
      keyPrefix: environment.REDIS_KEY_PREFIX,
    }),
    auth: Object.freeze({
      sessionCookieName: production
        ? '__Host-session'
        : 'nest-js-starter-session',
      secureCookie: production,
      ...runtimeDefaults.auth,
      sessionKeySecret: new Uint8Array(environment.AUTH_SESSION_KEY_SECRET),
      csrfSecret: new Uint8Array(environment.AUTH_CSRF_SECRET),
      rateLimitKeySecret: new Uint8Array(
        environment.AUTH_RATE_LIMIT_KEY_SECRET,
      ),
      networkMetadataSecret: new Uint8Array(
        environment.AUTH_NETWORK_METADATA_SECRET,
      ),
      csrfOrigins: Object.freeze(csrfOrigins),
      selfService: Object.freeze({
        mode: environment.AUTH_SELF_SERVICE_MODE,
        ...(environment.AUTH_PUBLIC_APP_URL === undefined
          ? {}
          : { publicAppUrl: environment.AUTH_PUBLIC_APP_URL }),
        ...(environment.AUTH_SMTP_URL === undefined
          ? {}
          : { smtpUrl: environment.AUTH_SMTP_URL }),
        ...(environment.AUTH_MAIL_FROM === undefined
          ? {}
          : { mailFrom: environment.AUTH_MAIL_FROM }),
        ...runtimeDefaults.auth.selfService,
      }),
      accountAdministration: Object.freeze({
        mode: environment.AUTH_ACCOUNT_ADMINISTRATION_MODE,
      }),
      accountEmailWorkflows: Object.freeze({
        mode: environment.AUTH_ACCOUNT_EMAIL_WORKFLOWS_MODE,
        ...runtimeDefaults.auth.accountEmailWorkflows,
      }),
    }),
  })
}

/**
 * Builds the minimal standalone-worker queue configuration.
 *
 * @param input - Untrusted environment record containing only the queue URL.
 * @returns Frozen queue settings with the reviewed platform defaults.
 * @throws RuntimeConfigurationError with redacted path/rule issues only.
 */
export function buildQueueWorkerRuntimeConfig(
  input: Record<string, unknown>,
): QueueRuntimeConfig {
  const environment = validateSchema(queueWorkerEnvironmentSchema, input)
  return buildQueueRuntimeConfig(environment)
}

/**
 * Builds standalone-worker queue configuration from process-owned variables.
 *
 * @returns Frozen queue settings for one worker process.
 * @throws RuntimeConfigurationError with redacted path/rule issues only.
 */
export function createQueueWorkerRuntimeConfig(): QueueRuntimeConfig {
  return buildQueueWorkerRuntimeConfig(process.env)
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

/**
 * Builds the minimal configuration projection for one outbox relay process.
 *
 * @param input - Untrusted process environment key/value record.
 * @returns PostgreSQL, queue and service identity settings only.
 * @throws RuntimeConfigurationError with redacted path/rule issues only.
 */
export function buildOutboxRelayRuntimeConfig(
  input: Record<string, unknown>,
): OutboxRelayRuntimeConfig {
  const environment = validateSchema(outboxRelayEnvironmentSchema, input)
  return Object.freeze({
    environment: environment.NODE_ENV,
    logging: buildLoggingConfig(environment),
    database: buildDatabaseConfig(environment),
    queue: buildQueueRuntimeConfig(environment),
  })
}
