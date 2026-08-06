import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import type { AuthRuntimeConfig } from '@/platform/config/runtime-config.types'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'

const databaseUrl =
  'postgresql://starter:local-password@localhost:5432/starter?schema=public'

const secret = (byte: number): string =>
  Buffer.alloc(32, byte).toString('base64url')

function createService(
  overrides: Record<string, unknown> = {},
): RuntimeConfigService {
  return new RuntimeConfigService(
    buildApiRuntimeConfig({
      DATABASE_URL: databaseUrl,
      REDIS_AUTH_URL: 'redis://default:local-redis-password@127.0.0.1:6379',
      AUTH_SESSION_KEY_SECRET: secret(1),
      AUTH_CSRF_SECRET: secret(2),
      AUTH_RATE_LIMIT_KEY_SECRET: secret(3),
      AUTH_NETWORK_METADATA_SECRET: secret(4),
      PUBLIC_API_URL: 'http://localhost:3000/',
      CORS_ORIGINS:
        'http://localhost:3000/, http://admin.local:3001/, http://localhost:3000',
      TRUST_PROXY_CIDRS: '127.0.0.1, 10.0.0.0/8',
      OTEL_SDK_DISABLED: true,
      ...overrides,
    }),
  )
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

  it('exposes immutable API documentation policy', () => {
    const service = createService()

    expect(service.docs).toEqual({ mode: 'public' })
    expect(Object.isFrozen(service.docs)).toBe(true)
  })

  it('exposes immutable Redis and auth groups without string-key access', () => {
    const runtimeService = createService()
    const service = runtimeService as unknown as Record<string, unknown>

    expect(service.redis).toEqual(
      expect.objectContaining({
        authUrl: 'redis://default:local-redis-password@127.0.0.1:6379',
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
    const exposedAuth = service.auth as AuthRuntimeConfig
    expect(exposedAuth).toEqual(
      expect.objectContaining({
        sessionCookieName: 'nest-js-starter-session',
        secureCookie: false,
        csrfOrigins: ['http://localhost:3000', 'http://admin.local:3001'],
      }),
    )
    expect(exposedAuth.selfService).toEqual(
      expect.objectContaining({
        mode: 'disabled',
        mailDeliveryTimeoutMs: 1_500,
      }),
    )
    expect(Object.isFrozen(service.redis)).toBe(true)
    expect(Object.isFrozen(service.auth)).toBe(true)
    expect(Object.isFrozen(exposedAuth.csrfOrigins)).toBe(true)
    expect(Object.isFrozen(exposedAuth.selfService)).toBe(true)
    exposedAuth.sessionKeySecret[0] = 255
    expect(runtimeService.auth.sessionKeySecret[0]).toBe(1)
  })

  it('exposes immutable logging and observability groups', () => {
    const service = createService()

    expect(service.logging).toEqual({
      level: 'info',
      serviceName: 'nest-js-starter',
      serviceVersion: '0.1.0-alpha.0',
      serviceRevision: 'unknown',
    })
    expect(service.observability).toEqual(
      expect.objectContaining({
        disabled: true,
        exporterTimeoutMs: 1_000,
        batchSpanScheduleDelayMs: 5_000,
        batchSpanExportTimeoutMs: 1_000,
      }),
    )
    expect(Object.isFrozen(service.logging)).toBe(true)
    expect(Object.isFrozen(service.observability)).toBe(true)
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
      redisAuthConfigured: true,
      redisQueueConfigured: false,
      authCookieName: 'nest-js-starter-session',
      authSelfServiceMode: 'disabled',
      authSmtpConfigured: false,
    })
    expect(JSON.stringify(summary)).not.toContain('local-password')
    expect(JSON.stringify(summary)).not.toContain(secret(1))
    expect(Object.isFrozen(summary)).toBe(true)
  })

  it('reports optional queue configuration without exposing its URL', () => {
    const service = createService({
      REDIS_QUEUE_URL: 'redis://queue-user:queue-secret@queue.internal:6380',
    })

    expect(service.redis).toEqual(
      expect.objectContaining({
        queueUrl: 'redis://queue-user:queue-secret@queue.internal:6380',
      }),
    )
    expect(service.safeSummary).toEqual(
      expect.objectContaining({
        redisAuthConfigured: true,
        redisQueueConfigured: true,
      }),
    )
    expect(JSON.stringify(service.safeSummary)).not.toContain('queue-secret')
  })

  it('exposes open self-service values without mutable nested state', () => {
    const service = createService({
      AUTH_SELF_SERVICE_MODE: 'open',
      AUTH_PUBLIC_APP_URL: 'http://app.local:3001',
      CORS_ORIGINS: 'http://localhost:3000, http://app.local:3001',
      AUTH_SMTP_URL: 'smtp://mailer:secret@smtp.local:587',
      AUTH_MAIL_FROM: 'no-reply@app.local',
    })

    expect(service.auth.selfService).toEqual(
      expect.objectContaining({
        mode: 'open',
        publicAppUrl: 'http://app.local:3001',
        smtpUrl: 'smtp://mailer:secret@smtp.local:587',
        mailFrom: 'no-reply@app.local',
      }),
    )
    expect(service.safeSummary).toEqual(
      expect.objectContaining({
        authSelfServiceMode: 'open',
        authSmtpConfigured: true,
      }),
    )
    expect(JSON.stringify(service.safeSummary)).not.toContain('secret')
    const exposed = service.auth.selfService as {
      mode: 'open' | 'disabled'
    }
    expect(() => {
      exposed.mode = 'disabled'
    }).toThrow()
    expect(service.auth.selfService.mode).toBe('open')
  })

  it('does not expose an arbitrary string-key accessor', () => {
    const service = createService() as RuntimeConfigService &
      Record<string, unknown>

    expect(service.get).toBeUndefined()
    expect(service.getOrThrow).toBeUndefined()
  })
})
