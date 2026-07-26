import { RuntimeConfigurationError } from '@/platform/config/runtime-config.types'
import {
  buildApiRuntimeConfig,
  buildPostgresCommandConfig,
  validateRuntimeEnvironment,
} from '@/platform/config/runtime-environment'

const databaseUrl =
  'postgresql://starter:local-password@localhost:5432/starter?schema=public'
const secret = (byte: number): string =>
  Buffer.alloc(32, byte).toString('base64url')
function requiredEnvironment(): Record<string, unknown> {
  return {
    DATABASE_URL: databaseUrl,
    REDIS_COORDINATION_URL:
      'redis://default:local-redis-password@127.0.0.1:6379',
    AUTH_SESSION_KEY_SECRET: secret(1),
    AUTH_CSRF_SECRET: secret(2),
    AUTH_RATE_LIMIT_KEY_SECRET: secret(3),
    AUTH_NETWORK_METADATA_SECRET: secret(4),
  }
}
function validate(
  input: Record<string, unknown> = {},
): ReturnType<typeof validateRuntimeEnvironment> {
  return validateRuntimeEnvironment({ ...requiredEnvironment(), ...input })
}

describe('runtime environment', () => {
  it('keeps only deployment inputs and normalizes safe defaults', () => {
    expect(validate()).toEqual(
      expect.objectContaining({
        NODE_ENV: 'development',
        API_DOCS_MODE: 'public',
        API_HOST: '127.0.0.1',
        API_PORT: 3000,
        PUBLIC_API_URL: 'http://localhost:3000',
        CORS_ORIGINS: ['http://localhost:3000'],
        TRUST_PROXY_CIDRS: [],
        REDIS_KEY_PREFIX: 'nest-js-starter',
      }),
    )
    expect(validate()).not.toHaveProperty('REDIS_CACHE_URL')
    expect(validate()).not.toHaveProperty('AUTH_CSRF_ORIGINS')
  })
  it('derives CSRF origins and cookies from deployment inputs', () => {
    const config = buildApiRuntimeConfig({
      ...requiredEnvironment(),
      CORS_ORIGINS: 'http://app.local:3001',
      PUBLIC_API_URL: 'http://api.local:3000',
    })
    expect(config.auth.csrfOrigins).toEqual([
      'http://app.local:3001',
      'http://api.local:3000',
    ])
    expect(config.auth.sessionCookieName).toBe('nest-js-starter-session')
    expect(config.auth.secureCookie).toBe(false)
    const production = buildApiRuntimeConfig({
      ...requiredEnvironment(),
      NODE_ENV: 'production',
      API_DOCS_MODE: 'protected',
      PUBLIC_API_URL: 'https://api.example.com',
      CORS_ORIGINS: 'https://app.example.com',
      TRUST_PROXY_CIDRS: '10.0.0.0/8',
    })
    expect(production.auth.sessionCookieName).toBe('__Host-session')
    expect(production.auth.secureCookie).toBe(true)
    expect(production.auth.csrfOrigins).toEqual([
      'https://app.example.com',
      'https://api.example.com',
    ])
  })
  it('normalizes a generic OTLP traces endpoint only', () => {
    expect(
      validate({
        OTEL_EXPORTER_OTLP_ENDPOINT: ' https://collector.example.com/otel/ ',
      }).OTEL_EXPORTER_OTLP_ENDPOINT,
    ).toBe('https://collector.example.com/otel/')
  })
  it.each([
    ['unknown docs mode', { API_DOCS_MODE: 'private' }],
    [
      'invalid database URL',
      { DATABASE_URL: 'mysql://root:secret@localhost/db' },
    ],
    ['invalid Redis URL', { REDIS_COORDINATION_URL: 'http://redis:6379' }],
    ['invalid public origin', { PUBLIC_API_URL: 'https://api.example.com/v1' }],
    ['invalid CORS origin', { CORS_ORIGINS: '*' }],
    ['missing secret', { AUTH_CSRF_SECRET: undefined }],
  ])('rejects %s without exposing values', (_name, input) => {
    expect(() => validate(input)).toThrow(RuntimeConfigurationError)
  })
  it('requires production HTTPS, proxy trust and protected/off docs', () => {
    const base = {
      ...requiredEnvironment(),
      NODE_ENV: 'production',
      PUBLIC_API_URL: 'https://api.example.com',
      CORS_ORIGINS: 'https://app.example.com',
      TRUST_PROXY_CIDRS: '10.0.0.0/8',
    }
    expect(
      validate({ ...base, API_DOCS_MODE: 'protected' }).API_DOCS_MODE,
    ).toBe('protected')
    expect(() => validate({ ...base, API_DOCS_MODE: 'public' })).toThrow(
      RuntimeConfigurationError,
    )
    expect(() =>
      validate({ ...base, PUBLIC_API_URL: 'http://api.example.com' }),
    ).toThrow(RuntimeConfigurationError)
    expect(() => validate({ ...base, TRUST_PROXY_CIDRS: '' })).toThrow(
      RuntimeConfigurationError,
    )
  })
  it('requires four distinct canonical 32-byte auth secrets', () => {
    expect(() => validate({ AUTH_SESSION_KEY_SECRET: secret(2) })).toThrow(
      RuntimeConfigurationError,
    )
    expect(() => validate({ AUTH_SESSION_KEY_SECRET: 'not-32-bytes' })).toThrow(
      RuntimeConfigurationError,
    )
  })
  it('builds PostgreSQL command config without Redis or auth placeholders', () => {
    const config = buildPostgresCommandConfig({ DATABASE_URL: databaseUrl })
    expect(config.database.url).toBe(databaseUrl)
    expect(config).not.toHaveProperty('redis')
    expect(config).not.toHaveProperty('auth')
    expect(config).not.toHaveProperty('docs')
  })
  it('does not retain secret sentinels in validation failures', () => {
    const sentinel = 'DO_NOT_LEAK_DATABASE_SECRET'
    try {
      validate({ DATABASE_URL: `mysql://root:${sentinel}@localhost/db` })
    } catch (error: unknown) {
      expect(String(error)).not.toContain(sentinel)
      expect(JSON.stringify(error)).not.toContain(sentinel)
      expect(error).toBeInstanceOf(RuntimeConfigurationError)
    }
  })
})
