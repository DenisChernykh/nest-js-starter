import { isIP } from 'node:net'

import Joi from 'joi'

import type {
  ValidatedPostgresCommandEnvironment,
  ValidatedQueueWorkerEnvironment,
  ValidatedRuntimeEnvironment,
} from './runtime-config.types'

function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return undefined
    }
    return url.origin
  } catch {
    return undefined
  }
}

function normalizeOriginList(value: string): readonly string[] | undefined {
  const members = value.split(',').map((member) => member.trim())
  if (members.some((member) => member === '' || member === '*')) {
    return undefined
  }
  const origins = members.map(normalizeOrigin)
  if (origins.some((origin) => origin === undefined)) return undefined
  return [...new Set(origins as string[])]
}

function isValidIpOrCidr(value: string): boolean {
  const [address, prefix, extra] = value.split('/')
  if (address === undefined || extra !== undefined) return false
  const family = isIP(address)
  if (family === 0) return false
  if (prefix === undefined) return true
  if (!/^\d+$/u.test(prefix)) return false
  const numericPrefix = Number(prefix)
  return numericPrefix >= 0 && numericPrefix <= (family === 4 ? 32 : 128)
}

function normalizeProxyList(value: string): readonly string[] | undefined {
  if (value.trim() === '') return []
  const members = value.split(',').map((member) => member.trim())
  if (members.some((member) => member === '' || !isValidIpOrCidr(member))) {
    return undefined
  }
  return [...new Set(members)]
}

function isPostgreSqlUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'postgres:' || protocol === 'postgresql:'
  } catch {
    return false
  }
}

function normalizeRedisUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    if (
      !['redis:', 'rediss:'].includes(url.protocol) ||
      url.hostname === '' ||
      url.hash !== '' ||
      url.search !== '' ||
      !['', '/'].includes(url.pathname)
    ) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function normalizeSmtpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    if (
      !['smtp:', 'smtps:'].includes(url.protocol) ||
      url.hostname === '' ||
      url.hash !== '' ||
      url.search !== '' ||
      !['', '/'].includes(url.pathname)
    ) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function normalizeMailFrom(value: string): string | undefined {
  const normalized = value.trim()
  return /^[^\s@<>]+@[^\s@<>]+$/u.test(normalized) ? normalized : undefined
}

function redisEndpointIdentity(value: string): string {
  const url = new URL(value)
  return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || '6379'}`
}

function normalizeOtlpHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.hostname === '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function decodeSecret(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.byteLength !== 32 || decoded.toString('base64url') !== value) {
    return undefined
  }
  return new Uint8Array(decoded)
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right))
}

const runtimeMode = Joi.string()
  .valid('development', 'test', 'production')
  .default('development')
const apiDocsMode = Joi.string().valid('off', 'public', 'protected')
const databaseUrl = Joi.string()
  .trim()
  .required()
  .custom((value: string, helpers) =>
    isPostgreSqlUrl(value) ? value : helpers.error('any.invalid'),
  )
const databasePoolMax = Joi.number().integer().min(1).max(100).default(10)
const logLevel = Joi.string()
  .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal')
  .default('info')
const serviceName = Joi.string()
  .trim()
  .pattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u)
  .default('nest-js-starter')
const serviceVersion = Joi.string()
  .trim()
  .pattern(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u)
  .default('0.1.0-alpha.0')
const serviceRevision = Joi.string()
  .trim()
  .pattern(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u)
  .default('unknown')
const otlpHttpUrl = Joi.string()
  .trim()
  .custom(
    (value: string, helpers) =>
      normalizeOtlpHttpUrl(value) ?? helpers.error('any.invalid'),
  )
const redisUrl = Joi.string()
  .trim()
  .custom(
    (value: string, helpers) =>
      normalizeRedisUrl(value) ?? helpers.error('any.invalid'),
  )
const secretBytes = Joi.string()
  .trim()
  .required()
  .custom(
    (value: string, helpers) =>
      decodeSecret(value) ?? helpers.error('any.invalid'),
  )
const selfServiceMode = Joi.string()
  .valid('disabled', 'open')
  .default('disabled')
const selfServiceAppUrl = Joi.string()
  .trim()
  .empty('')
  .custom(
    (value: string, helpers) =>
      normalizeOrigin(value) ?? helpers.error('any.invalid'),
  )
  .optional()
const selfServiceSmtpUrl = Joi.string()
  .trim()
  .empty('')
  .custom(
    (value: string, helpers) =>
      normalizeSmtpUrl(value) ?? helpers.error('any.invalid'),
  )
  .optional()
const selfServiceMailFrom = Joi.string()
  .trim()
  .empty('')
  .custom(
    (value: string, helpers) =>
      normalizeMailFrom(value) ?? helpers.error('any.invalid'),
  )
  .optional()

/**
 * Validates only deployment inputs; internal deadlines and auth tuning come
 * from the immutable runtime defaults object.
 */
export const runtimeEnvironmentSchema = Joi.object<ValidatedRuntimeEnvironment>(
  {
    NODE_ENV: runtimeMode,
    API_DOCS_MODE: Joi.when('NODE_ENV', {
      is: 'production',
      then: Joi.string().valid('off', 'protected').default('off'),
      otherwise: apiDocsMode.default('public'),
    }),
    LOG_LEVEL: logLevel,
    OTEL_SERVICE_NAME: serviceName,
    SERVICE_VERSION: serviceVersion,
    SERVICE_REVISION: serviceRevision,
    OTEL_SDK_DISABLED: Joi.boolean().default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: otlpHttpUrl.empty('').optional(),
    API_HOST: Joi.string().trim().min(1).default('127.0.0.1'),
    API_PORT: Joi.number().integer().min(1).max(65_535).default(3000),
    PUBLIC_API_URL: Joi.string()
      .trim()
      .default('http://localhost:3000')
      .custom(
        (value: string, helpers) =>
          normalizeOrigin(value) ?? helpers.error('any.invalid'),
      ),
    CORS_ORIGINS: Joi.any()
      .custom((value: unknown, helpers) =>
        typeof value === 'string'
          ? (normalizeOriginList(value) ?? helpers.error('any.invalid'))
          : helpers.error('any.invalid'),
      )
      .default(['http://localhost:3000']),
    TRUST_PROXY_CIDRS: Joi.any()
      .custom((value: unknown, helpers) =>
        typeof value === 'string'
          ? (normalizeProxyList(value) ?? helpers.error('any.invalid'))
          : helpers.error('any.invalid'),
      )
      .default([]),
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: databasePoolMax,
    REDIS_AUTH_URL: redisUrl.required(),
    REDIS_QUEUE_URL: redisUrl.empty('').optional(),
    REDIS_KEY_PREFIX: Joi.string()
      .pattern(/^[a-z0-9](?:[a-z0-9-]{0,62})$/u)
      .default('nest-js-starter'),
    AUTH_SESSION_KEY_SECRET: secretBytes,
    AUTH_CSRF_SECRET: secretBytes,
    AUTH_RATE_LIMIT_KEY_SECRET: secretBytes,
    AUTH_NETWORK_METADATA_SECRET: secretBytes,
    AUTH_SELF_SERVICE_MODE: selfServiceMode,
    AUTH_PUBLIC_APP_URL: selfServiceAppUrl,
    AUTH_SMTP_URL: selfServiceSmtpUrl,
    AUTH_MAIL_FROM: selfServiceMailFrom,
  },
).custom((value: ValidatedRuntimeEnvironment, helpers) => {
  const authSecrets = [
    value.AUTH_SESSION_KEY_SECRET,
    value.AUTH_CSRF_SECRET,
    value.AUTH_RATE_LIMIT_KEY_SECRET,
    value.AUTH_NETWORK_METADATA_SECRET,
  ]
  const secretsAreDistinct = authSecrets.every((secret, index) =>
    authSecrets
      .slice(index + 1)
      .every((otherSecret) => !byteArraysEqual(secret, otherSecret)),
  )
  const productionIsSafe =
    value.NODE_ENV !== 'production' ||
    (value.PUBLIC_API_URL.startsWith('https://') &&
      value.CORS_ORIGINS.every((origin) => origin.startsWith('https://')) &&
      value.TRUST_PROXY_CIDRS.length > 0)
  const queueEndpointIsDistinct =
    value.REDIS_QUEUE_URL === undefined ||
    redisEndpointIdentity(value.REDIS_AUTH_URL) !==
      redisEndpointIdentity(value.REDIS_QUEUE_URL)
  const selfServiceIsComplete =
    value.AUTH_SELF_SERVICE_MODE === 'disabled' ||
    (value.AUTH_PUBLIC_APP_URL !== undefined &&
      value.AUTH_SMTP_URL !== undefined &&
      value.AUTH_MAIL_FROM !== undefined)
  const productionSelfServiceIsSafe =
    value.AUTH_SELF_SERVICE_MODE !== 'open' ||
    value.NODE_ENV !== 'production' ||
    value.AUTH_PUBLIC_APP_URL?.startsWith('https://') === true

  return secretsAreDistinct &&
    productionIsSafe &&
    queueEndpointIsDistinct &&
    selfServiceIsComplete &&
    productionSelfServiceIsSafe
    ? value
    : helpers.error('any.invalid')
})

/** Validates the minimal environment required by a standalone queue worker. */
export const queueWorkerEnvironmentSchema =
  Joi.object<ValidatedQueueWorkerEnvironment>({
    REDIS_QUEUE_URL: redisUrl.required(),
  })

/** Validates only deployment inputs needed by a PostgreSQL one-shot command. */
export const postgresCommandEnvironmentSchema =
  Joi.object<ValidatedPostgresCommandEnvironment>({
    NODE_ENV: runtimeMode,
    LOG_LEVEL: logLevel,
    OTEL_SERVICE_NAME: serviceName,
    SERVICE_VERSION: serviceVersion,
    SERVICE_REVISION: serviceRevision,
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: databasePoolMax,
  })
