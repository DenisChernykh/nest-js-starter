import type { DynamicModule, Provider, Type } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'

import { AccountAdministrationModule } from '@/modules/identity-access/account-administration/composition/account-administration.module'
import { AccountLifecycleModule } from '@/modules/identity-access/account-lifecycle/composition/account-lifecycle.module'
import { AuthenticationModule } from '@/modules/identity-access/authentication/composition/authentication.module'
import { AuthorizationModule } from '@/modules/identity-access/authorization/composition/authorization.module'
import { AuthRequestInterceptor } from '@/modules/identity-access/authorization/presentation/auth-request.interceptor'
import { AuthenticationGuard } from '@/modules/identity-access/authorization/presentation/authentication.guard'
import { BrowserOriginGuard } from '@/modules/identity-access/authorization/presentation/browser-origin.guard'
import { PermissionGuard } from '@/modules/identity-access/authorization/presentation/permission.guard'
import { SessionCsrfGuard } from '@/modules/identity-access/authorization/presentation/session-csrf.guard'
import { IdentityAccessModule } from '@/modules/identity-access/composition/identity-access.module'
import { IdentityModule } from '@/modules/identity-access/identity/composition/identity.module'
import { SessionsModule } from '@/modules/identity-access/sessions/composition/sessions.module'

describe('IdentityAccessModule composition', () => {
  it('shares one configured authorization graph and owns the ordered chain', () => {
    const configured = IdentityAccessModule.forRoot({ roleDefinitions: [] })
    const imports = configured.imports as [
      typeof IdentityModule,
      typeof SessionsModule,
      typeof AuthenticationModule,
      DynamicModule,
      DynamicModule,
      DynamicModule,
    ]

    expect(imports.map(readModuleClass)).toEqual([
      IdentityModule,
      SessionsModule,
      AuthenticationModule,
      AuthorizationModule,
      AccountLifecycleModule,
      AccountAdministrationModule,
    ])

    const authorizationModule = imports[3]
    const accountLifecycleModule = imports[4]
    const accountAdministrationModule = imports[5]
    expect(accountLifecycleModule.imports).toContain(authorizationModule)
    expect(accountAdministrationModule.imports).toContain(authorizationModule)
    expect(configured.exports).toBeUndefined()

    expect(configured.providers).toEqual([
      { provide: APP_GUARD, useExisting: AuthenticationGuard },
      { provide: APP_GUARD, useExisting: BrowserOriginGuard },
      { provide: APP_GUARD, useExisting: SessionCsrfGuard },
      { provide: APP_GUARD, useExisting: PermissionGuard },
      { provide: APP_INTERCEPTOR, useExisting: AuthRequestInterceptor },
    ] satisfies Provider[])
  })
})

function readModuleClass(module: DynamicModule | Type<unknown>): Type<unknown> {
  return typeof module === 'function' ? module : module.module
}
