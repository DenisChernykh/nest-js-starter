import { ConfigService } from '@nestjs/config'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import type {
  AuthRuntimeConfig,
  ValidatedRuntimeEnvironment,
} from '@/platform/config/runtime-config.types'
import { validateRuntimeEnvironment } from '@/platform/config/runtime-environment'

const databaseUrl =
  'postgresql://starter:local-password@localhost:5432/starter?schema=public'

const secret = (byte: number): string =>
  Buffer.alloc(32, byte).toString('base64url')

function createService(): RuntimeConfigService {
  const environment = validateRuntimeEnvironment({
    DATABASE_URL: databaseUrl,
    REDIS_COORDINATION_URL:
      'redis://default:local-redis-password@127.0.0.1:6379',
    AUTH_SESSION_KEY_SECRET: secret(1),
    AUTH_CSRF_SECRET: secret(2),
    AUTH_RATE_LIMIT_KEY_SECRET: secret(3),
    AUTH_NETWORK_METADATA_SECRET: secret(4),
    AUTH_CSRF_ORIGINS: 'http://localhost:3000,http://admin.local:3001',
    PUBLIC_API_URL: 'http://localhost:3000/',
    CORS_ORIGINS:
      'http://localhost:3000/, http://admin.local:3001/, http://localhost:3000',
    TRUST_PROXY_CIDRS: '127.0.0.1, 10.0.0.0/8',
  })
  const configService = new ConfigService<ValidatedRuntimeEnvironment, true>(
    environment,
  )
  return new RuntimeConfigService(configService)
}

describe('RuntimeConfigService', () => {
  it('exposes grouped immutable HTTP and database configuration', () => {
    const service = createService()

    expect(service.http).toEqual(
      expect.objectContaining({
        publicApiUrl: 'http://localhost:3000',
        corsOrigins: ['http://localhost:3000', 'http://admin.local:3001'],
        trustedProxyCidrs: ['127.0.0.1', '10.0.0.0/8'],
      }),
    )
    expect(service.database.url).toBe(databaseUrl)
    expect(Object.isFrozen(service.http)).toBe(true)
    expect(Object.isFrozen(service.http.corsOrigins)).toBe(true)
    expect(Object.isFrozen(service.http.trustedProxyCidrs)).toBe(true)
    expect(Object.isFrozen(service.database)).toBe(true)
  })

  it('exposes immutable Redis and auth groups without string-key access', () => {
    const runtimeService = createService()
    const service = runtimeService as unknown as Record<string, unknown>

    expect(service.redis).toEqual(
      expect.objectContaining({
        coordinationUrl: 'redis://default:local-redis-password@127.0.0.1:6379',
        connectTimeoutMs: 2_000,
        commandTimeoutMs: 2_000,
        healthTimeoutMs: 2_500,
        shutdownTimeoutMs: 1_000,
        keyPrefix: 'nest-js-starter',
      }),
    )
    expect(
      (service.redis as { readonly cacheUrl?: string }).cacheUrl,
    ).toBeUndefined()
    expect(service.auth).toEqual(
      expect.objectContaining({
        sessionCookieName: 'nest-js-starter-session',
        secureCookie: false,
        csrfOrigins: ['http://localhost:3000', 'http://admin.local:3001'],
      }),
    )
    expect(Object.isFrozen(service.redis)).toBe(true)
    expect(Object.isFrozen(service.auth)).toBe(true)
    const exposedAuth = service.auth as AuthRuntimeConfig
    expect(Object.isFrozen(exposedAuth.csrfOrigins)).toBe(true)
    exposedAuth.sessionKeySecret[0] = 255
    expect(runtimeService.auth.sessionKeySecret[0]).toBe(1)
  })

  it('returns a frozen startup-safe summary without the database URL', () => {
    const summary = createService().safeSummary

    expect(summary).toEqual({
      environment: 'development',
      apiHost: '127.0.0.1',
      apiPort: 3000,
      publicApiOrigin: 'http://localhost:3000',
      corsOriginCount: 2,
      trustedProxyCount: 2,
      databasePoolMax: 10,
      redisCoordinationConfigured: true,
      redisCacheConfigured: false,
      authCookieName: 'nest-js-starter-session',
    })
    expect(JSON.stringify(summary)).not.toContain('local-password')
    expect(JSON.stringify(summary)).not.toContain(secret(1))
    expect(Object.isFrozen(summary)).toBe(true)
  })

  it('does not expose an arbitrary string-key accessor', () => {
    const service = createService() as RuntimeConfigService &
      Record<string, unknown>

    expect(service.get).toBeUndefined()
    expect(service.getOrThrow).toBeUndefined()
  })
})
