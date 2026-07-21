import { ConfigService } from '@nestjs/config'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import type { ValidatedRuntimeEnvironment } from '@/platform/config/runtime-config.types'
import { validateRuntimeEnvironment } from '@/platform/config/runtime-environment'

const databaseUrl =
  'postgresql://starter:local-password@localhost:5432/starter?schema=public'

function createService(): RuntimeConfigService {
  const environment = validateRuntimeEnvironment({
    DATABASE_URL: databaseUrl,
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
    })
    expect(JSON.stringify(summary)).not.toContain('local-password')
    expect(Object.isFrozen(summary)).toBe(true)
  })

  it('does not expose an arbitrary string-key accessor', () => {
    const service = createService() as RuntimeConfigService &
      Record<string, unknown>

    expect(service.get).toBeUndefined()
    expect(service.getOrThrow).toBeUndefined()
  })
})
