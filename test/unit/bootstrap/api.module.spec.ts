import { Test } from '@nestjs/testing'

import type { ApiModule as ApiModuleClass } from '@/bootstrap/api/api.module'
import { API_ROLE_DEFINITIONS } from '@/bootstrap/api/api-auth.roles'
import { RoleRegistry } from '@/modules/auth/authorization/application/role-registry'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'

describe('ApiModule composition', () => {
  it('compiles the API without requiring the opt-in queue configuration', async () => {
    const rawEnvironment = {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_AUTH_URL: 'redis://127.0.0.1:6379',
      AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
      AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
      AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
      AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
      OTEL_SDK_DISABLED: 'true',
    }
    const config = buildApiRuntimeConfig(rawEnvironment)
    expect(config.redis.queueUrl).toBeUndefined()
    const apiModule =
      (await import('../../../src/bootstrap/api/api.module.js')) as {
        readonly ApiModule: typeof ApiModuleClass
      }
    const testingModule = await Test.createTestingModule({
      imports: [apiModule.ApiModule.forRoot(config)],
    }).compile()

    expect(testingModule.get(RuntimeConfigService).observability.disabled).toBe(
      true,
    )
    const roles = testingModule.get(RoleRegistry)
    expect(Object.isFrozen(roles)).toBe(true)
    expect([...roles.resolve('active', ['system.admin'])]).toContain(
      'system.docs.read',
    )
    expect(Object.isFrozen(API_ROLE_DEFINITIONS)).toBe(true)
    expect(Object.isFrozen(API_ROLE_DEFINITIONS[0])).toBe(true)
    expect(Object.isFrozen(API_ROLE_DEFINITIONS[0]?.permissions)).toBe(true)

    await testingModule.close()
  })
})
