import { RuntimeConfigurationError } from '@/platform/config/runtime-config.types'
import { validateRuntimeEnvironment } from '@/platform/config/runtime-environment'

const databaseUrl =
  'postgresql://starter:local-password@localhost:5432/starter?schema=public'

function productionEnvironment(): Record<string, unknown> {
  return {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'production',
    PUBLIC_API_URL: 'https://api.example.com',
    CORS_ORIGINS: 'https://app.example.com',
    TRUST_PROXY_CIDRS: '10.0.0.0/8,2001:db8::/32',
  }
}

describe('validateRuntimeEnvironment', () => {
  it('applies the subject-neutral development defaults', () => {
    const result = validateRuntimeEnvironment({ DATABASE_URL: databaseUrl })

    expect(result).toEqual(
      expect.objectContaining({
        NODE_ENV: 'development',
        API_HOST: '127.0.0.1',
        API_PORT: 3000,
        PUBLIC_API_URL: 'http://localhost:3000',
        CORS_ORIGINS: ['http://localhost:3000'],
        TRUST_PROXY_CIDRS: [],
        DATABASE_URL: databaseUrl,
      }),
    )
  })

  it('accepts an HTTPS production configuration with explicit proxies', () => {
    expect(validateRuntimeEnvironment(productionEnvironment())).toEqual(
      expect.objectContaining({
        NODE_ENV: 'production',
        PUBLIC_API_URL: 'https://api.example.com',
        CORS_ORIGINS: ['https://app.example.com'],
        TRUST_PROXY_CIDRS: ['10.0.0.0/8', '2001:db8::/32'],
      }),
    )
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
    expect(() => validateRuntimeEnvironment(input)).toThrow(
      RuntimeConfigurationError,
    )
  })

  it.each([
    'ftp://api.example.com',
    'https://user:password@api.example.com',
    'https://api.example.com/v1',
    'https://api.example.com?debug=true',
    'https://api.example.com#fragment',
  ])('rejects invalid public API origin %s', (publicApiUrl) => {
    expect(() =>
      validateRuntimeEnvironment({
        DATABASE_URL: databaseUrl,
        PUBLIC_API_URL: publicApiUrl,
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('rejects HTTP public API origins in production', () => {
    expect(() =>
      validateRuntimeEnvironment({
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
      validateRuntimeEnvironment({
        DATABASE_URL: databaseUrl,
        CORS_ORIGINS: corsOrigins,
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('rejects HTTP CORS origins in production', () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...productionEnvironment(),
        CORS_ORIGINS: 'http://app.example.com',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('normalizes origins and deduplicates CORS entries in input order', () => {
    const result = validateRuntimeEnvironment({
      DATABASE_URL: databaseUrl,
      PUBLIC_API_URL: ' http://localhost:3000/ ',
      CORS_ORIGINS:
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
      validateRuntimeEnvironment({
        DATABASE_URL: databaseUrl,
        TRUST_PROXY_CIDRS: '  ',
      }).TRUST_PROXY_CIDRS,
    ).toEqual([])
  })

  it('requires an explicit proxy allowlist in production', () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...productionEnvironment(),
        TRUST_PROXY_CIDRS: '',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it.each(['10.0.0.0/33', '2001:db8::/129', 'not-an-address'])(
    'rejects invalid proxy address or CIDR %s',
    (trustedProxyCidrs) => {
      expect(() =>
        validateRuntimeEnvironment({
          DATABASE_URL: databaseUrl,
          TRUST_PROXY_CIDRS: trustedProxyCidrs,
        }),
      ).toThrow(RuntimeConfigurationError)
    },
  )

  it('requires the headers timeout not to exceed request receive timeout', () => {
    expect(() =>
      validateRuntimeEnvironment({
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
      validateRuntimeEnvironment({
        DATABASE_URL: databaseUrl,
        HTTP_DRAIN_TIMEOUT_MS: drainTimeoutMs,
        SHUTDOWN_GRACE_MS: '10000',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('requires the health deadline to include Pool connection timeout', () => {
    expect(() =>
      validateRuntimeEnvironment({
        DATABASE_URL: databaseUrl,
        DATABASE_CONNECTION_TIMEOUT_MS: '2000',
        DATABASE_HEALTH_TIMEOUT_MS: '1999',
      }),
    ).toThrow(RuntimeConfigurationError)
  })

  it('keeps Pool connection timeout inside the shutdown settle window', () => {
    expect(() =>
      validateRuntimeEnvironment({
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
      validateRuntimeEnvironment({
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
      validateRuntimeEnvironment({
        DATABASE_URL: databaseUrl,
        UNRELATED_OPERATING_SYSTEM_KEY: 'any-value',
      }),
    ).not.toThrow()
  })
})
