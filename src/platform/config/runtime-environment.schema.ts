import { isIP } from 'node:net'

import Joi from 'joi'

import type { ValidatedRuntimeEnvironment } from './runtime-config.types'

const maximumTimeoutMs = 86_400_000

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
  if (origins.some((origin) => origin === undefined)) {
    return undefined
  }
  return [...new Set(origins as string[])]
}

function isValidIpOrCidr(value: string): boolean {
  const [address, prefix, extra] = value.split('/')
  if (address === undefined || extra !== undefined) {
    return false
  }
  const family = isIP(address)
  if (family === 0) {
    return false
  }
  if (prefix === undefined) {
    return true
  }
  if (!/^\d+$/u.test(prefix)) {
    return false
  }
  const numericPrefix = Number(prefix)
  return numericPrefix >= 0 && numericPrefix <= (family === 4 ? 32 : 128)
}

function normalizeProxyList(value: string): readonly string[] | undefined {
  if (value.trim() === '') {
    return []
  }
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
      ![
        '',
        '/',
        ...Array.from({ length: 16 }, (_, index) => `/${index}`),
      ].includes(url.pathname)
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

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  )
}

function usesLogicalRedisDatabase(value: string | undefined): boolean {
  if (value === undefined) return false
  const pathname = new URL(value).pathname
  return pathname !== '' && pathname !== '/'
}

const positiveMilliseconds = Joi.number().integer().min(1).max(maximumTimeoutMs)
const sessionMilliseconds = Joi.number().integer().min(1).max(7_776_000_000)
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

/**
 * Validates and normalizes every environment key owned by the runtime slice.
 *
 * @remarks Unknown process keys are allowed by the caller. Custom validators
 * return normalized strings and arrays without retaining mutable URL objects.
 */
export const runtimeEnvironmentSchema = Joi.object<ValidatedRuntimeEnvironment>(
  {
    NODE_ENV: Joi.string()
      .valid('development', 'test', 'production')
      .default('development'),
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
    HTTP_JSON_BODY_LIMIT_BYTES: Joi.number()
      .integer()
      .min(1)
      .max(10_485_760)
      .default(1_048_576),
    HTTP_REQUEST_TIMEOUT_MS: positiveMilliseconds.default(30_000),
    HTTP_HEADERS_TIMEOUT_MS: positiveMilliseconds.default(10_000),
    HTTP_KEEP_ALIVE_TIMEOUT_MS: positiveMilliseconds.default(5_000),
    HTTP_DRAIN_TIMEOUT_MS: positiveMilliseconds.default(6_000),
    SHUTDOWN_GRACE_MS: positiveMilliseconds.default(10_000),
    DATABASE_URL: Joi.string()
      .trim()
      .required()
      .custom((value: string, helpers) =>
        isPostgreSqlUrl(value) ? value : helpers.error('any.invalid'),
      ),
    DATABASE_POOL_MAX: Joi.number().integer().min(1).max(100).default(10),
    DATABASE_CONNECTION_TIMEOUT_MS: positiveMilliseconds.default(2_000),
    DATABASE_IDLE_TIMEOUT_MS: positiveMilliseconds.default(300_000),
    DATABASE_HEALTH_TIMEOUT_MS: positiveMilliseconds.default(2_000),
    DATABASE_TRANSACTION_MAX_WAIT_MS: positiveMilliseconds.default(5_000),
    DATABASE_TRANSACTION_TIMEOUT_MS: positiveMilliseconds.default(10_000),
    REDIS_COORDINATION_URL: redisUrl.required(),
    REDIS_CACHE_URL: redisUrl.empty('').optional(),
    REDIS_CONNECT_TIMEOUT_MS: positiveMilliseconds.default(2_000),
    REDIS_COMMAND_TIMEOUT_MS: positiveMilliseconds.default(2_000),
    REDIS_HEALTH_TIMEOUT_MS: positiveMilliseconds.default(2_500),
    REDIS_SHUTDOWN_TIMEOUT_MS: positiveMilliseconds.default(1_000),
    REDIS_KEY_PREFIX: Joi.string()
      .pattern(/^[a-z0-9](?:[a-z0-9-]{0,62})$/u)
      .default('nest-js-starter'),
    AUTH_SESSION_COOKIE_NAME: Joi.string().when('NODE_ENV', {
      is: 'production',
      then: Joi.valid('__Host-session').default('__Host-session'),
      otherwise: Joi.string().trim().min(1).default('nest-js-starter-session'),
    }),
    AUTH_COOKIE_SECURE: Joi.boolean().when('NODE_ENV', {
      is: 'production',
      then: Joi.valid(true).default(true),
      otherwise: Joi.boolean().default(false),
    }),
    AUTH_SESSION_IDLE_TIMEOUT_MS: sessionMilliseconds.default(604_800_000),
    AUTH_SESSION_ABSOLUTE_TIMEOUT_MS:
      sessionMilliseconds.default(2_592_000_000),
    AUTH_SESSION_TOUCH_INTERVAL_MS: sessionMilliseconds.default(300_000),
    AUTH_SESSION_KEY_SECRET: secretBytes,
    AUTH_CSRF_SECRET: secretBytes,
    AUTH_RATE_LIMIT_KEY_SECRET: secretBytes,
    AUTH_NETWORK_METADATA_SECRET: secretBytes,
    AUTH_CSRF_ORIGINS: Joi.any()
      .custom((value: unknown, helpers) =>
        typeof value === 'string'
          ? (normalizeOriginList(value) ?? helpers.error('any.invalid'))
          : helpers.error('any.invalid'),
      )
      .required(),
    AUTH_LOGIN_IP_LIMIT: Joi.number().integer().min(1).max(10_000).default(20),
    AUTH_LOGIN_ACCOUNT_LIMIT: Joi.number()
      .integer()
      .min(1)
      .max(10_000)
      .default(10),
    AUTH_LOGIN_WINDOW_MS: positiveMilliseconds.default(900_000),
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
  const expectedCsrfOrigins = [
    ...new Set([...value.CORS_ORIGINS, value.PUBLIC_API_URL]),
  ]
  const failures =
    value.HTTP_HEADERS_TIMEOUT_MS > value.HTTP_REQUEST_TIMEOUT_MS ||
    value.HTTP_DRAIN_TIMEOUT_MS >= value.SHUTDOWN_GRACE_MS ||
    value.SHUTDOWN_GRACE_MS - value.HTTP_DRAIN_TIMEOUT_MS < 2_000 ||
    value.DATABASE_CONNECTION_TIMEOUT_MS > value.DATABASE_HEALTH_TIMEOUT_MS ||
    value.DATABASE_CONNECTION_TIMEOUT_MS >
      value.SHUTDOWN_GRACE_MS - value.HTTP_DRAIN_TIMEOUT_MS - 1_000 ||
    value.REDIS_CONNECT_TIMEOUT_MS > value.REDIS_HEALTH_TIMEOUT_MS ||
    value.REDIS_SHUTDOWN_TIMEOUT_MS >
      value.SHUTDOWN_GRACE_MS - value.HTTP_DRAIN_TIMEOUT_MS ||
    value.AUTH_SESSION_IDLE_TIMEOUT_MS >
      value.AUTH_SESSION_ABSOLUTE_TIMEOUT_MS ||
    value.AUTH_SESSION_TOUCH_INTERVAL_MS >=
      value.AUTH_SESSION_IDLE_TIMEOUT_MS ||
    !secretsAreDistinct ||
    !sameStringSet(value.AUTH_CSRF_ORIGINS, expectedCsrfOrigins) ||
    (value.NODE_ENV === 'production' &&
      (!value.PUBLIC_API_URL.startsWith('https://') ||
        value.CORS_ORIGINS.some((origin) => !origin.startsWith('https://')) ||
        value.TRUST_PROXY_CIDRS.length === 0 ||
        usesLogicalRedisDatabase(value.REDIS_COORDINATION_URL) ||
        usesLogicalRedisDatabase(value.REDIS_CACHE_URL)))

  return failures ? helpers.error('any.invalid') : value
})
