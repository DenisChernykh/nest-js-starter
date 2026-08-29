import type { Provider } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'

import { AuthModule } from '@/modules/auth/composition/auth.module'
import { definePermissions } from '@/modules/auth/authorization/application/permission'
import {
  AuthorizationModule,
  type ConfiguredAuthorizationModule,
} from '@/modules/auth/authorization/composition/authorization.module'
import {
  RoleRegistry,
  type RoleDefinition,
} from '@/modules/auth/authorization/application/role-registry'
import { AuthRequestContext } from '@/modules/auth/authorization/presentation/auth-request.context'
import { AuthRequestInterceptor } from '@/modules/auth/authorization/presentation/auth-request.interceptor'
import { AuthenticationGuard } from '@/modules/auth/authorization/presentation/authentication.guard'
import { BrowserOriginGuard } from '@/modules/auth/authorization/presentation/browser-origin.guard'
import { PermissionGuard } from '@/modules/auth/authorization/presentation/permission.guard'
import { SessionCsrfGuard } from '@/modules/auth/authorization/presentation/session-csrf.guard'
import { SessionsModule } from '@/modules/auth/sessions/composition/sessions.module'
import { DOCS_ACCESS_POLICY } from '@/platform/http/docs/docs-access.contracts'

interface RoleSnapshotProvider {
  readonly provide: string | symbol
  readonly useValue: readonly RoleDefinition[]
}

interface RoleRegistryFactoryProvider {
  readonly provide: typeof RoleRegistry
  readonly useFactory: (definitions: readonly RoleDefinition[]) => RoleRegistry
}

function isRoleSnapshotProvider(
  provider: Provider,
): provider is RoleSnapshotProvider {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'useValue' in provider &&
    Array.isArray(provider.useValue)
  )
}

function isRoleRegistryFactoryProvider(
  provider: Provider,
): provider is RoleRegistryFactoryProvider {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'provide' in provider &&
    provider.provide === RoleRegistry &&
    'useFactory' in provider &&
    typeof provider.useFactory === 'function'
  )
}

describe('AuthorizationModule composition', () => {
  it('owns one frozen role registry snapshot and exports its operational boundary', () => {
    const permissions = [...definePermissions(['system.docs.read'])]
    const roleDefinitions = [
      { key: 'system.admin', permissions },
    ] satisfies RoleDefinition[]
    const configured = AuthorizationModule.forRoot(roleDefinitions)
    roleDefinitions[0]!.key = 'changed.after.composition'
    permissions.splice(0)

    expect(configured.imports).toEqual([SessionsModule])

    const providers = configured.providers ?? []
    const roleSnapshotProvider = providers.find(isRoleSnapshotProvider)
    if (roleSnapshotProvider === undefined)
      throw new Error('Role snapshot provider missing')
    const roleSnapshot = roleSnapshotProvider.useValue
    expect(roleSnapshot).toEqual([
      { key: 'system.admin', permissions: ['system.docs.read'] },
    ])
    expect(Object.isFrozen(roleSnapshot)).toBe(true)
    expect(Object.isFrozen(roleSnapshot?.[0])).toBe(true)
    expect(Object.isFrozen(roleSnapshot?.[0]?.permissions)).toBe(true)

    const registryProviders = providers.filter(isRoleRegistryFactoryProvider)
    expect(registryProviders).toHaveLength(1)
    const registry = registryProviders[0]!.useFactory(roleSnapshot)
    expect(registry).toBeInstanceOf(RoleRegistry)
    expect(Object.isFrozen(registry)).toBe(true)
    expect(registry.listRoles()).toEqual([
      { key: 'system.admin', permissions: ['system.docs.read'] },
    ])

    expect(configured.exports).toEqual([
      RoleRegistry,
      AuthRequestContext,
      AuthenticationGuard,
      BrowserOriginGuard,
      SessionCsrfGuard,
      PermissionGuard,
      AuthRequestInterceptor,
      DOCS_ACCESS_POLICY,
    ])
    expect(
      providers.filter(
        (provider) =>
          typeof provider === 'object' &&
          provider !== null &&
          'provide' in provider &&
          (provider.provide === APP_GUARD ||
            provider.provide === APP_INTERCEPTOR),
      ),
    ).toEqual([])
  })

  it('lets the legacy root register the global chain around one configured module', () => {
    const legacy = AuthModule.forRoot({ roleDefinitions: [] })
    const [configured] = legacy.imports as [ConfiguredAuthorizationModule]

    expect(legacy.imports).toHaveLength(1)
    expect(configured.module).toBe(AuthorizationModule)
    expect(legacy.exports).toEqual([configured])
    expect(legacy.providers).toEqual([
      { provide: APP_GUARD, useExisting: AuthenticationGuard },
      { provide: APP_GUARD, useExisting: BrowserOriginGuard },
      { provide: APP_GUARD, useExisting: SessionCsrfGuard },
      { provide: APP_GUARD, useExisting: PermissionGuard },
      { provide: APP_INTERCEPTOR, useExisting: AuthRequestInterceptor },
    ])
  })
})
