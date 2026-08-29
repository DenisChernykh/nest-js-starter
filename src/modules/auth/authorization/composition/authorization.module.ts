import { Module, type DynamicModule } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { AuthAuditPort } from '../../application/auth-audit.port'
import { GetCsrfTokenQuery } from '../../sessions/application/get-csrf-token.query'
import { SessionsModule } from '../../sessions/composition/sessions.module'
import { AuthenticateSessionUseCase } from '../application/authenticate-session.use-case'
import { GetMeQuery } from '../application/get-me.query'
import {
  createAuthRoleRegistry,
  RoleRegistry,
  type RoleDefinition,
} from '../application/role-registry'
import { AuthController } from '../presentation/auth.controller'
import { AuthRequestContext } from '../presentation/auth-request.context'
import { AuthRequestInterceptor } from '../presentation/auth-request.interceptor'
import { AuthenticationGuard } from '../presentation/authentication.guard'
import { BrowserOriginGuard } from '../presentation/browser-origin.guard'
import { DocsAccessPolicyAdapter } from '../presentation/docs-access-policy.adapter'
import { PermissionGuard } from '../presentation/permission.guard'
import { SessionCsrfGuard } from '../presentation/session-csrf.guard'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import {
  DOCS_ACCESS_POLICY,
  type DocsAccessPolicy,
} from '@/platform/http/docs/docs-access.contracts'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'

const AUTHORIZATION_ROLE_DEFINITIONS = Symbol(
  'auth:authorization-role-definitions',
)
declare const configuredAuthorizationModuleBrand: unique symbol

export type ConfiguredAuthorizationModule = DynamicModule & {
  readonly [configuredAuthorizationModuleBrand]: true
}

function snapshotRoleDefinitions(
  definitions: readonly RoleDefinition[],
): readonly RoleDefinition[] {
  return Object.freeze(
    definitions.map((definition) =>
      Object.freeze({
        key: definition.key,
        permissions: Object.freeze([...definition.permissions]),
      }),
    ),
  )
}

@Module({})
export class AuthorizationModule {
  public static forRoot(
    roleDefinitions: readonly RoleDefinition[],
  ): ConfiguredAuthorizationModule {
    const roleSnapshot = snapshotRoleDefinitions(roleDefinitions)

    const dynamicModule: DynamicModule = {
      module: AuthorizationModule,
      imports: [SessionsModule],
      controllers: [AuthController],
      providers: [
        {
          provide: AUTHORIZATION_ROLE_DEFINITIONS,
          useValue: roleSnapshot,
        },
        {
          provide: RoleRegistry,
          inject: [AUTHORIZATION_ROLE_DEFINITIONS],
          useFactory: (
            definitions: readonly RoleDefinition[],
          ): RoleRegistry => {
            const registry = createAuthRoleRegistry(definitions)
            Object.freeze(registry)
            return registry
          },
        },
        AuthRequestContext,
        AuthenticateSessionUseCase,
        GetMeQuery,
        {
          provide: AuthenticationGuard,
          inject: [
            Reflector,
            AuthenticateSessionUseCase,
            AuthRequestContext,
            RuntimeConfigService,
          ],
          useFactory: (
            reflector: Reflector,
            authenticate: AuthenticateSessionUseCase,
            requestContext: AuthRequestContext,
            config: RuntimeConfigService,
          ): AuthenticationGuard =>
            new AuthenticationGuard(
              reflector,
              authenticate,
              requestContext,
              config.auth.sessionCookieName,
            ),
        },
        {
          provide: BrowserOriginGuard,
          inject: [RuntimeConfigService],
          useFactory: (config: RuntimeConfigService): BrowserOriginGuard =>
            new BrowserOriginGuard(config.auth.csrfOrigins),
        },
        {
          provide: SessionCsrfGuard,
          inject: [Reflector, AuthRequestContext, GetCsrfTokenQuery],
          useFactory: (
            reflector: Reflector,
            requestContext: AuthRequestContext,
            csrf: GetCsrfTokenQuery,
          ): SessionCsrfGuard =>
            new SessionCsrfGuard(reflector, requestContext, csrf),
        },
        PermissionGuard,
        AuthRequestInterceptor,
        {
          provide: DOCS_ACCESS_POLICY,
          inject: [
            AuthenticateSessionUseCase,
            AuthAuditLogger,
            RuntimeConfigService,
          ],
          useFactory: (
            authenticate: AuthenticateSessionUseCase,
            audit: AuthAuditPort,
            config: RuntimeConfigService,
          ): DocsAccessPolicy | null =>
            config.docs.mode === 'protected'
              ? new DocsAccessPolicyAdapter(
                  authenticate,
                  audit,
                  config.auth.sessionCookieName,
                )
              : null,
        },
      ],
      exports: [
        RoleRegistry,
        AuthRequestContext,
        AuthenticationGuard,
        BrowserOriginGuard,
        SessionCsrfGuard,
        PermissionGuard,
        AuthRequestInterceptor,
        DOCS_ACCESS_POLICY,
      ],
    }
    return dynamicModule as ConfiguredAuthorizationModule
  }
}
