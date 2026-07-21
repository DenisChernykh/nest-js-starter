import { RuntimeConfigurationError } from '@/platform/config/runtime-config.types'
import {
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
    AUTH_CSRF_ORIGINS: 'http://localhost:3000',
  }
}

function validateEnvironment(
  input: Record<string, unknown>,
): ReturnType<typeof validateRuntimeEnvironment> {
  return validateRuntimeEnvironment({ ...requiredEnvironment(), ...input })
}

function productionEnvironment(): Record<string, unknown> {
  return {
    ...requiredEnvironment(),
    NODE_ENV: 'production',
    PUBLIC_API_URL: 'https://api.example.com',
    CORS_ORIGINS: 'https://app.example.com',
    AUTH_CSRF_ORIGINS: 'https://app.example.com,https://api.example.com',
    TRUST_PROXY_CIDRS: '10.0.0.0/8,2001:db8::/32',
  }
}

describe('validateRuntimeEnvironment', () => {
  it('applies the subject-neutral development defaults', () => {
    const result = validateEnvironment({})

    expect(result).toEqual(
      expect.objectContaining({
        NODE_ENV: 'development',
        API_HOST: '127.0.0.1',
        API_PORT: 3000,
        PUBLIC_API_URL: 'http://localhost:3000',
        CORS_ORIGINS: ['http://localhost:3000'],
        TRUST_PROXY_CIDRS: [],
        DATABASE_URL: databaseUrl,
        REDIS_COORDINATION_URL:
          'redis://default:local-redis-password@127.0.0.1:6379',
        AUTH_SESSION_COOKIE_NAME: 'nest-js-starter-session',
        AUTH_COOKIE_SECURE: false,
        LOG_LEVEL: 'info',
        OTEL_SERVICE_NAME: 'nest-js-starter',
        SERVICE_VERSION: '0.1.0-alpha.0',
        SERVICE_REVISION: 'unknown',
        OTEL_SDK_DISABLED: false,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
        OTEL_EXPORTER_OTLP_TIMEOUT: 1_000,
        OTEL_METRIC_EXPORT_INTERVAL: 60_000,
        OTEL_METRIC_EXPORT_TIMEOUT: 10_000,
        OTEL_BSP_SCHEDULE_DELAY: 5_000,
        OTEL_BSP_EXPORT_TIMEOUT: 1_000,
      }),
    )
  })

  it('normalizes reviewed logging metadata and standard OTLP HTTP settings', () => {
    expect(
      validateEnvironment({
        LOG_LEVEL: 'debug',
        OTEL_SERVICE_NAME: 'orders-api',
        SERVICE_VERSION: '2026.07.21',
        SERVICE_REVISION: 'abc1234',
        OTEL_SDK_DISABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: ' https://collector.example.com/otel/ ',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          'https://collector.example.com/v1/traces',
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:
          'https://collector.example.com/v1/metrics',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/protobuf',
        OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'http/protobuf',
        OTEL_EXPORTER_OTLP_TIMEOUT: '750',
        OTEL_METRIC_EXPORT_INTERVAL: '30000',
        OTEL_METRIC_EXPORT_TIMEOUT: '5000',
        OTEL_BSP_SCHEDULE_DELAY: '2500',
        OTEL_BSP_EXPORT_TIMEOUT: '750',
      }),
    ).toEqual(
      expect.objectContaining({
        LOG_LEVEL: 'debug',
        OTEL_SERVICE_NAME: 'orders-api',
        SERVICE_VERSION: '2026.07.21',
        SERVICE_REVISION: 'abc1234',
        OTEL_SDK_DISABLED: true,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com/otel/',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          'https://collector.example.com/v1/traces',
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:
          'https://collector.example.com/v1/metrics',
        OTEL_EXPORTER_OTLP_TIMEOUT: 750,
        OTEL_METRIC_EXPORT_INTERVAL: 30_000,
        OTEL_METRIC_EXPORT_TIMEOUT: 5_000,
        OTEL_BSP_SCHEDULE_DELAY: 2_500,
        OTEL_BSP_EXPORT_TIMEOUT: 750,
      }),
    )
  })

  it.each([
    ['silent logging', { LOG_LEVEL: 'silent' }],
    ['empty service name', { OTEL_SERVICE_NAME: ' ' }],
    ['spaced service version', { SERVICE_VERSION: 'release candidate' }],
    ['FTP collector', { OTEL_EXPORTER_OTLP_ENDPOINT: 'ftp://collector/otel' }],
    [
      'credential-bearing collector',
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://user:secret@collector/otel' },
    ],
    [
      'query-bearing traces collector',
      {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
          'https://collector/v1/traces?token=secret',
      },
    ],
    ['gRPC protocol', { OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' }],
    ['zero exporter timeout', { OTEL_EXPORTER_OTLP_TIMEOUT: 0 }],
    [
      'metric timeout above interval',
      {
        OTEL_METRIC_EXPORT_INTERVAL: 1_000,
        OTEL_METRIC_EXPORT_TIMEOUT: 1_001,
      },
    ],
    [
      'span export timeout outside shutdown reserve',
      {
        HTTP_DRAIN_TIMEOUT_MS: 6_000,
        SHUTDOWN_GRACE_MS: 10_000,
        OTEL_BSP_EXPORT_TIMEOUT: 4_001,
      },
    ],
  ])('rejects %s', (_name, input) => {
    expect(() => validateEnvironment(input)).toThrow(RuntimeConfigurationError)
  })

  it('does not retain rejected collector credentials', () => {
    const sentinel = 'DO_NOT_LEAK_OTEL_CREDENTIAL'

    try {
      validateEnvironment({
        OTEL_EXPORTER_OTLP_ENDPOINT: `https://${sentinel}@collector/otel`,
      })
      throw new Error('Expected validation to fail')
    } catch (error: unknown) {
      expect(String(error)).not.toContain(sentinel)
      expect(JSON.stringify(error)).not.toContain(sentinel)
      expect(error).toBeInstanceOf(RuntimeConfigurationError)
    }
  })

  it('builds PostgreSQL command config without Redis or auth placeholders', () => {
    const config = buildPostgresCommandConfig({ DATABASE_URL: databaseUrl })
    expect(config.database.url).toBe(databaseUrl)
    expect(config.logging.serviceName).toBe('nest-js-starter')
    expect(config).not.toHaveProperty('redis')
    expect(config).not.toHaveProperty('auth')
  })

  it('accepts an HTTPS production configuration with explicit proxies', () => {
    expect(validateEnvironment(productionEnvironment())).toEqual(
      expect.objectContaining({
        NODE_ENV: 'production',
        PUBLIC_API_URL: 'https://api.example.com',
        CORS_ORIGINS: ['https://app.example.com'],
        TRUST_PROXY_CIDRS: ['10.0.0.0/8', '2001:db8::/32'],
        AUTH_SESSION_COOKIE_NAME: '__Host-session',
        AUTH_COOKIE_SECURE: true,
      }),
    )
  })

  it('normalizes ACL Redis URLs and decodes independent auth secrets', () => {
    const result = validateEnvironment({
      REDIS_COORDINATION_URL:
        'redis://coordination-user:coordination-password@redis.internal:6379',
      REDIS_CACHE_URL: 'rediss://cache-user:cache-password@cache.internal:6380',
    })

    expect(result).toEqual(
      expect.objectContaining({
        REDIS_COORDINATION_URL:
          'redis://coordination-user:coordination-password@redis.internal:6379',
        REDIS_CACHE_URL:
          'rediss://cache-user:cache-password@cache.internal:6380',
        REDIS_CONNECT_TIMEOUT_MS: 2_000,
        REDIS_COMMAND_TIMEOUT_MS: 2_000,
        REDIS_HEALTH_TIMEOUT_MS: 2_500,
        REDIS_SHUTDOWN_TIMEOUT_MS: 1_000,
        REDIS_KEY_PREFIX: 'nest-js-starter',
        AUTH_SESSION_KEY_SECRET: new Uint8Array(Buffer.alloc(32, 1)),
        AUTH_CSRF_SECRET: new Uint8Array(Buffer.alloc(32, 2)),
        AUTH_RATE_LIMIT_KEY_SECRET: new Uint8Array(Buffer.alloc(32, 3)),
        AUTH_NETWORK_METADATA_SECRET: new Uint8Array(Buffer.alloc(32, 4)),
      }),
    )
  })

  it('normalizes an empty optional cache URL to undefined', () => {
    expect(validateEnvironment({ REDIS_CACHE_URL: '' }).REDIS_CACHE_URL).toBe(
      undefined,
    )
  })

  it.each([
    ['missing coordination URL', { REDIS_COORDINATION_URL: undefined }],
    ['HTTP coordination URL', { REDIS_COORDINATION_URL: 'http://redis:6379' }],
    [
      'coordination URL fragment',
      { REDIS_COORDINATION_URL: 'redis://redis:6379#secret' },
    ],
  ])('rejects %s', (_name, input) => {
    expect(() => validateEnvironment(input)).toThrow(RuntimeConfigurationError)
  })

  it('rejects Redis logical database numbers in production', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment(),
        REDIS_COORDINATION_URL:
          'rediss://coordination-user:password@redis.internal:6380/1',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('requires four distinct 32-byte base64url auth secrets', () => {
    expect(() =>
      validateEnvironment({
        AUTH_CSRF_SECRET: secret(1),
      }),
    ).toThrow(RuntimeConfigurationError)
    expect(() =>
      validateEnvironment({
        AUTH_SESSION_KEY_SECRET: 'not-32-bytes',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('requires the CSRF origin set to equal CORS origins plus the API origin', () => {
    expect(() =>
      validateEnvironment({
        PUBLIC_API_URL: 'http://api.local:3000',
        CORS_ORIGINS: 'http://app.local:3001',
        AUTH_CSRF_ORIGINS: 'http://app.local:3001',
      }),
    ).toThrow(RuntimeConfigurationError)
    expect(() =>
      validateEnvironment({
        AUTH_CSRF_ORIGINS: 'http://localhost:3000,http://unexpected.local:3002',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it.each([
    ['non-host production cookie', { AUTH_SESSION_COOKIE_NAME: 'session' }],
    ['insecure production cookie', { AUTH_COOKIE_SECURE: false }],
    [
      'idle timeout above absolute timeout',
      {
        AUTH_SESSION_IDLE_TIMEOUT_MS: 2_000,
        AUTH_SESSION_ABSOLUTE_TIMEOUT_MS: 1_999,
      },
    ],
    [
      'touch interval at idle timeout',
      {
        AUTH_SESSION_TOUCH_INTERVAL_MS: 1_000,
        AUTH_SESSION_IDLE_TIMEOUT_MS: 1_000,
      },
    ],
    [
      'Redis connect timeout above health timeout',
      { REDIS_CONNECT_TIMEOUT_MS: 3_000, REDIS_HEALTH_TIMEOUT_MS: 2_999 },
    ],
    [
      'Redis shutdown outside cleanup reserve',
      {
        HTTP_DRAIN_TIMEOUT_MS: 6_000,
        SHUTDOWN_GRACE_MS: 10_000,
        REDIS_SHUTDOWN_TIMEOUT_MS: 4_001,
      },
    ],
  ])('rejects %s', (_name, input) => {
    const environment = _name.includes('production')
      ? { ...productionEnvironment(), ...input }
      : input
    expect(() => validateEnvironment(environment)).toThrow(
      RuntimeConfigurationError,
    )
  })

  it('never retains rejected Redis URLs or auth secrets in failures', () => {
    const secretSentinel = 'DO_NOT_LEAK_AUTH_SECRET'

    try {
      validateEnvironment({
        REDIS_COORDINATION_URL: `http://${secretSentinel}@redis.internal`,
        AUTH_SESSION_KEY_SECRET: secretSentinel,
      })
      throw new Error('Expected validation to fail')
    } catch (error: unknown) {
      expect(String(error)).not.toContain(secretSentinel)
      expect(JSON.stringify(error)).not.toContain(secretSentinel)
      expect(error).toBeInstanceOf(RuntimeConfigurationError)
    }
  })

  it.each([
    ['missing database URL', { DATABASE_URL: undefined }],
    ['unknown environment', { DATABASE_URL: databaseUrl, NODE_ENV: 'staging' }],
    ['non-numeric API port', { DATABASE_URL: databaseUrl, API_PORT: 'many' }],
    ['zero API port', { DATABASE_URL: databaseUrl, API_PORT: '0' }],
    ['out-of-range API port', { DATABASE_URL: databaseUrl, API_PORT: '65536' }],
    [
      'non-PostgreSQL database URL',
      { DATABASE_URL: 'mysql://root:secret@localhost/database' },
    ],
    [
      'zero request timeout',
      { DATABASE_URL: databaseUrl, HTTP_REQUEST_TIMEOUT_MS: '0' },
    ],
    [
      'unbounded request timeout',
      { DATABASE_URL: databaseUrl, HTTP_REQUEST_TIMEOUT_MS: 'Infinity' },
    ],
  ])('rejects %s', (_name, input) => {
    expect(() => validateEnvironment(input)).toThrow(RuntimeConfigurationError)
  })

  it.each([
    'ftp://api.example.com',
    'https://user:password@api.example.com',
    'https://api.example.com/v1',
    'https://api.example.com?debug=true',
    'https://api.example.com#fragment',
  ])('rejects invalid public API origin %s', (publicApiUrl) => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        PUBLIC_API_URL: publicApiUrl,
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('rejects HTTP public API origins in production', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment(),
        PUBLIC_API_URL: 'http://api.example.com',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it.each([
    '*',
    'https://user:password@app.example.com',
    'https://app.example.com/path',
    'https://app.example.com?debug=true',
    'https://app.example.com#fragment',
    'https://app.example.com,,https://admin.example.com',
  ])('rejects invalid CORS origin list %s', (corsOrigins) => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        CORS_ORIGINS: corsOrigins,
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('rejects HTTP CORS origins in production', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment(),
        CORS_ORIGINS: 'http://app.example.com',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('normalizes origins and deduplicates CORS entries in input order', () => {
    const result = validateEnvironment({
      DATABASE_URL: databaseUrl,
      PUBLIC_API_URL: ' http://localhost:3000/ ',
      CORS_ORIGINS:
        ' http://localhost:3000/, http://admin.local:3001/ ,http://localhost:3000 ',
      AUTH_CSRF_ORIGINS:
        ' http://localhost:3000/, http://admin.local:3001/ ,http://localhost:3000 ',
    })

    expect(result.PUBLIC_API_URL).toBe('http://localhost:3000')
    expect(result.CORS_ORIGINS).toEqual([
      'http://localhost:3000',
      'http://admin.local:3001',
    ])
  })

  it('allows an empty proxy allowlist outside production', () => {
    expect(
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        TRUST_PROXY_CIDRS: '  ',
      }).TRUST_PROXY_CIDRS,
    ).toEqual([])
  })

  it('requires an explicit proxy allowlist in production', () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment(),
        TRUST_PROXY_CIDRS: '',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it.each(['10.0.0.0/33', '2001:db8::/129', 'not-an-address'])(
    'rejects invalid proxy address or CIDR %s',
    (trustedProxyCidrs) => {
      expect(() =>
        validateEnvironment({
          DATABASE_URL: databaseUrl,
          TRUST_PROXY_CIDRS: trustedProxyCidrs,
        }),
      ).toThrow(RuntimeConfigurationError)
    },
  )

  it('requires the headers timeout not to exceed request receive timeout', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        HTTP_REQUEST_TIMEOUT_MS: '1000',
        HTTP_HEADERS_TIMEOUT_MS: '1001',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it.each([
    ['equal drain and shutdown deadlines', '10000'],
    ['insufficient settle and cleanup reserve', '8001'],
  ])('rejects %s', (_name, drainTimeoutMs) => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        HTTP_DRAIN_TIMEOUT_MS: drainTimeoutMs,
        SHUTDOWN_GRACE_MS: '10000',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('requires the health deadline to include Pool connection timeout', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        DATABASE_CONNECTION_TIMEOUT_MS: '2000',
        DATABASE_HEALTH_TIMEOUT_MS: '1999',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('keeps Pool connection timeout inside the shutdown settle window', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        DATABASE_CONNECTION_TIMEOUT_MS: '3001',
        DATABASE_HEALTH_TIMEOUT_MS: '4000',
        HTTP_DRAIN_TIMEOUT_MS: '6000',
        SHUTDOWN_GRACE_MS: '10000',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('never includes a secret sentinel in validation failures', () => {
    const secretSentinel = 'DO_NOT_LEAK_DATABASE_SECRET'

    try {
      validateEnvironment({
        DATABASE_URL: `mysql://root:${secretSentinel}@localhost/database`,
        API_PORT: secretSentinel,
      })
      throw new Error('Expected validation to fail')
    } catch (error: unknown) {
      expect(String(error)).not.toContain(secretSentinel)
      expect(JSON.stringify(error)).not.toContain(secretSentinel)
      expect(error).toBeInstanceOf(RuntimeConfigurationError)
    }
  })

  it('ignores unrelated process environment keys', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        UNRELATED_OPERATING_SYSTEM_KEY: 'any-value',
      }),
    ).not.toThrow()
  })
})
