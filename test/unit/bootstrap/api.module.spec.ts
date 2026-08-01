import type { Provider, ValueProvider } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import type { ApiModule as ApiModuleClass } from '@/bootstrap/api/api.module'
import { API_ROLE_DEFINITIONS } from '@/bootstrap/api/api-auth.roles'
import { definePermissions } from '@/modules/auth/application/permission'
import type { RoleDefinition } from '@/modules/auth/application/role-registry'
import { RoleRegistry } from '@/modules/auth/application/role-registry'
import { AuthModule } from '@/modules/auth/composition/auth.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'

function isValueProvider(
  provider: Provider,
): provider is ValueProvider<unknown> {
  return (
    typeof provider === 'object' && provider !== null && 'useValue' in provider
  )
}

describe('ApiModule composition', () => {
  it('snapshots and freezes product roles at the auth composition boundary', () => {
    const permissions = [...definePermissions(['system.docs.read'])]
    const roleDefinitions = [
      { key: 'system.admin', permissions },
    ] satisfies RoleDefinition[]

    const dynamicModule = AuthModule.forRoot({ roleDefinitions })
    roleDefinitions[0]!.key = 'changed.after.composition'
    permissions.splice(0)

    const roleSnapshot = dynamicModule.providers
      ?.filter(isValueProvider)
      .map((provider) => provider.useValue)
      .find(Array.isArray) as readonly RoleDefinition[] | undefined

    expect(roleSnapshot).toEqual([
      {
        key: 'system.admin',
        permissions: ['system.docs.read'],
      },
    ])
    expect(roleSnapshot).not.toBe(roleDefinitions)
    expect(Object.isFrozen(roleSnapshot)).toBe(true)
    expect(Object.isFrozen(roleSnapshot?.[0])).toBe(true)
    expect(Object.isFrozen(roleSnapshot?.[0]?.permissions)).toBe(true)
  })

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
    expect([
      ...testingModule.get(RoleRegistry).resolve('active', ['system.admin']),
    ]).toContain('system.docs.read')
    expect(Object.isFrozen(API_ROLE_DEFINITIONS)).toBe(true)
    expect(Object.isFrozen(API_ROLE_DEFINITIONS[0])).toBe(true)
    expect(Object.isFrozen(API_ROLE_DEFINITIONS[0]?.permissions)).toBe(true)

    await testingModule.close()
  })
})
