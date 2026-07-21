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

const positiveMilliseconds = Joi.number().integer().min(1).max(maximumTimeoutMs)

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
  },
).custom((value: ValidatedRuntimeEnvironment, helpers) => {
  const failures =
    value.HTTP_HEADERS_TIMEOUT_MS > value.HTTP_REQUEST_TIMEOUT_MS ||
    value.HTTP_DRAIN_TIMEOUT_MS >= value.SHUTDOWN_GRACE_MS ||
    value.SHUTDOWN_GRACE_MS - value.HTTP_DRAIN_TIMEOUT_MS < 2_000 ||
    value.DATABASE_CONNECTION_TIMEOUT_MS > value.DATABASE_HEALTH_TIMEOUT_MS ||
    value.DATABASE_CONNECTION_TIMEOUT_MS >
      value.SHUTDOWN_GRACE_MS - value.HTTP_DRAIN_TIMEOUT_MS - 1_000 ||
    (value.NODE_ENV === 'production' &&
      (!value.PUBLIC_API_URL.startsWith('https://') ||
        value.CORS_ORIGINS.some((origin) => !origin.startsWith('https://')) ||
        value.TRUST_PROXY_CIDRS.length === 0))

  return failures ? helpers.error('any.invalid') : value
})
