import { Module, type DynamicModule } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'

import { AccountAdministrationModule } from '../account-administration/composition/account-administration.module'
import { AccountLifecycleModule } from '../account-lifecycle/composition/account-lifecycle.module'
import { AuthenticationModule } from '../authentication/composition/authentication.module'
import type { RoleDefinition } from '../authorization/application/role-registry'
import {
  AuthorizationModule,
  type ConfiguredAuthorizationModule,
} from '../authorization/composition/authorization.module'
import { AuthRequestInterceptor } from '../authorization/presentation/auth-request.interceptor'
import { AuthenticationGuard } from '../authorization/presentation/authentication.guard'
import { BrowserOriginGuard } from '../authorization/presentation/browser-origin.guard'
import { PermissionGuard } from '../authorization/presentation/permission.guard'
import { SessionCsrfGuard } from '../authorization/presentation/session-csrf.guard'
import { IdentityModule } from '../identity/composition/identity.module'
import { SessionsModule } from '../sessions/composition/sessions.module'

export interface IdentityAccessModuleOptions {
  readonly roleDefinitions: readonly RoleDefinition[]
}

@Module({})
export class IdentityAccessModule {
  public static forRoot(options: IdentityAccessModuleOptions): DynamicModule {
    const authorizationModule: ConfiguredAuthorizationModule =
      AuthorizationModule.forRoot(options.roleDefinitions)
    const accountLifecycleModule =
      AccountLifecycleModule.register(authorizationModule)
    const accountAdministrationModule =
      AccountAdministrationModule.register(authorizationModule)

    return {
      module: IdentityAccessModule,
      imports: [
        IdentityModule,
        SessionsModule,
        AuthenticationModule,
        authorizationModule,
        accountLifecycleModule,
        accountAdministrationModule,
      ],
      providers: [
        { provide: APP_GUARD, useExisting: AuthenticationGuard },
        { provide: APP_GUARD, useExisting: BrowserOriginGuard },
        { provide: APP_GUARD, useExisting: SessionCsrfGuard },
        { provide: APP_GUARD, useExisting: PermissionGuard },
        { provide: APP_INTERCEPTOR, useExisting: AuthRequestInterceptor },
      ],
    }
  }
}
