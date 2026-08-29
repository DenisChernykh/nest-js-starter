import type { DynamicModule, Provider, Type } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'

import { AccountAdministrationModule } from '@/modules/auth/account-administration/composition/account-administration.module'
import { AccountLifecycleModule } from '@/modules/auth/account-lifecycle/composition/account-lifecycle.module'
import { AuthenticationModule } from '@/modules/auth/authentication/composition/authentication.module'
import { AuthorizationModule } from '@/modules/auth/authorization/composition/authorization.module'
import { AuthRequestInterceptor } from '@/modules/auth/authorization/presentation/auth-request.interceptor'
import { AuthenticationGuard } from '@/modules/auth/authorization/presentation/authentication.guard'
import { BrowserOriginGuard } from '@/modules/auth/authorization/presentation/browser-origin.guard'
import { PermissionGuard } from '@/modules/auth/authorization/presentation/permission.guard'
import { SessionCsrfGuard } from '@/modules/auth/authorization/presentation/session-csrf.guard'
import { IdentityAccessModule } from '@/modules/auth/composition/identity-access.module'
import { IdentityModule } from '@/modules/auth/identity/composition/identity.module'
import { SessionsModule } from '@/modules/auth/sessions/composition/sessions.module'

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
