import { Module, type DynamicModule } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core'

import { AUTH_AUDIT } from '../application/auth-audit.port'
import { ACCOUNT_PROVISIONING } from '../application/account-provisioning.port'
import {
  ACCOUNT_ADMINISTRATION_MUTATION,
  type AccountAdministrationMutationPort,
} from '../application/account-administration-mutation.port'
import {
  ACCOUNT_ADMINISTRATION_READ,
  type AccountAdministrationReadPort,
} from '../application/account-administration-read.port'
import { AccountAdministrationService } from '../application/account-administration.service'
import { AccountEmailWorkflowsPolicy } from '../application/account-email-workflows.policy'
import { AccountEmailWorkflowsService } from '../application/account-email-workflows.service'
import {
  AUTH_MAIL_DELIVERY,
  type AuthMailDeliveryPort,
} from '../application/auth-mail-delivery.port'
import {
  AUTH_DUMMY_PASSWORD_HASH,
  AUTH_SESSION_CLEANUP_OBSERVER,
  NOOP_AUTH_SESSION_CLEANUP_OBSERVER,
  type AuthSessionCleanupObserver,
} from '../application/auth.types'
import { AuthenticateSessionUseCase } from '../application/authenticate-session.use-case'
import { ChangePasswordUseCase } from '../application/change-password.use-case'
import { ConfirmEmailVerificationUseCase } from '../application/confirm-email-verification.use-case'
import { ConfirmPasswordResetUseCase } from '../application/confirm-password-reset.use-case'
import { GetCsrfTokenQuery } from '../application/get-csrf-token.query'
import { GetMeQuery } from '../application/get-me.query'
import { EMAIL_VERIFICATION_PERSISTENCE } from '../application/email-verification-persistence.port'
import { IDENTITY_SECURITY_STATE } from '../application/identity-security-state.port'
import { INVITATION_PERSISTENCE } from '../application/invitation-persistence.port'
import { LOGIN_RATE_LIMITER } from '../application/login-rate-limiter.port'
import { ListSessionsQuery } from '../application/list-sessions.query'
import { LoginUseCase } from '../application/login.use-case'
import { LogoutAllUseCase } from '../application/logout-all.use-case'
import { LogoutUseCase } from '../application/logout.use-case'
import { PASSWORD_HASHER } from '../application/password-hasher.port'
import { PASSWORD_CREDENTIALS } from '../application/password-credential.port'
import { PASSWORD_RECOVERY_PERSISTENCE } from '../application/password-recovery-persistence.port'
import {
  createAuthRoleRegistry,
  RoleRegistry,
  type RoleDefinition,
} from '../application/role-registry'
import { RevokeSessionUseCase } from '../application/revoke-session.use-case'
import { ONE_TIME_TOKEN_CODEC } from '../application/one-time-token-codec.port'
import { PUBLIC_AUTH_RATE_LIMITER } from '../application/public-auth-rate-limiter.port'
import { REGISTRATION_PERSISTENCE } from '../application/registration-persistence.port'
import { RegisterUserUseCase } from '../application/register-user.use-case'
import { RequestPasswordResetUseCase } from '../application/request-password-reset.use-case'
import { ResendEmailVerificationUseCase } from '../application/resend-email-verification.use-case'
import { SESSION_STORE } from '../application/session-store.port'
import { SESSION_GENERATION } from '../application/session-generation.port'
import { SessionIssuer } from '../application/session-issuer'
import { SelfServiceAuthPolicy } from '../application/self-service-auth.policy'
import { PrismaAccountAdministrationMutationAdapter } from '../account-administration/infrastructure/prisma-account-administration-mutation.adapter'
import { PrismaAccountAdministrationReadAdapter } from '../account-administration/infrastructure/prisma-account-administration-read.adapter'
import { PrismaAccountProvisioningAdapter } from '../account-administration/provisioning/infrastructure/prisma-account-provisioning.adapter'
import { PrismaEmailVerificationAdapter } from '../account-lifecycle/email-verification/infrastructure/prisma-email-verification.adapter'
import { PrismaInvitationAdapter } from '../account-lifecycle/invitations/infrastructure/prisma-invitation.adapter'
import { NodeAccountLifecycleCryptoAdapter } from '../account-lifecycle/infrastructure/node-account-lifecycle-crypto.adapter'
import { PrismaPasswordRecoveryAdapter } from '../account-lifecycle/password-recovery/infrastructure/prisma-password-recovery.adapter'
import { PrismaRegistrationAdapter } from '../account-lifecycle/registration/infrastructure/prisma-registration.adapter'
import { NodePasswordAuthCryptoAdapter } from '../authentication/password/infrastructure/node-password-auth-crypto.adapter'
import { PrismaPasswordCredentialAdapter } from '../authentication/password/infrastructure/prisma-password-credential.adapter'
import { PrismaIdentitySecurityStateAdapter } from '../identity/infrastructure/prisma-identity-security-state.adapter'
import { Argon2PasswordHasher } from '../infrastructure/argon2-password.hasher'
import { NodemailerAuthMailAdapter } from '../infrastructure/nodemailer-auth-mail.adapter'
import { RedisLoginRateLimiter } from '../infrastructure/redis-login-rate-limiter'
import { RedisPublicAuthRateLimiter } from '../infrastructure/redis-public-auth-rate-limiter'
import { RedisSessionStore } from '../infrastructure/redis-session.store'
import { NodeSessionCryptoAdapter } from '../sessions/infrastructure/node-session-crypto.adapter'
import { PrismaSessionGenerationAdapter } from '../sessions/infrastructure/prisma-session-generation.adapter'
import { AuthCookieAdapter } from '../presentation/auth-cookie.adapter'
import { AdminAccountController } from '../presentation/admin-account.controller'
import { AdminAccountEmailWorkflowsController } from '../presentation/admin-account-email-workflows.controller'
import { AccountEmailWorkflowsController } from '../presentation/account-email-workflows.controller'
import { PublicAuthResponseDelay } from '../presentation/public-auth-response-delay'
import {
  AUTH_LOGIN_METADATA_FACTORY,
  AuthController,
  type LoginRequestMetadataFactory,
} from '../presentation/auth.controller'
import { AuthRequestContext } from '../presentation/auth-request.context'
import { AuthRequestInterceptor } from '../presentation/auth-request.interceptor'
import { AuthenticationGuard } from '../presentation/authentication.guard'
import { BrowserOriginGuard } from '../presentation/browser-origin.guard'
import { DocsAccessPolicyAdapter } from '../presentation/docs-access-policy.adapter'
import { PermissionGuard } from '../presentation/permission.guard'
import { SessionCsrfGuard } from '../presentation/session-csrf.guard'
import { SelfServiceAuthController } from '../presentation/self-service-auth.controller'
import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { DatabaseModule } from '@/platform/database/database.module'
import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'
import { RedisModule } from '@/platform/redis/redis.module'
import { REDIS_AUTH_COMMAND_EXECUTOR } from '@/platform/redis/redis.tokens'
import {
  DOCS_ACCESS_POLICY,
  type DocsAccessPolicy,
} from '@/platform/http/docs/docs-access.contracts'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'

const dummyPasswordHash =
  '$argon2id$v=19$m=19456,p=1,t=2$AQEBAQEBAQEBAQEBAQEBAQ$89iZHLNRbRP/PDabySsV1BxlW1VfqedCPSqmvYANw2U'

const AUTH_ROLE_DEFINITIONS = Symbol('auth:role-definitions')

/** Product-owned role catalog required to compose the auth capability. */
export interface AuthModuleOptions {
  readonly roleDefinitions: readonly RoleDefinition[]
}

/** Composes durable identity, Redis sessions and ordered browser policy. */
@Module({
  imports: [RuntimeConfigModule, DatabaseModule, RedisModule],
  controllers: [
    AuthController,
    SelfServiceAuthController,
    AdminAccountController,
    AdminAccountEmailWorkflowsController,
    AccountEmailWorkflowsController,
  ],
  providers: [
    AuthRequestContext,
    GetMeQuery,
    Argon2PasswordHasher,
    NodeAccountLifecycleCryptoAdapter,
    NodePasswordAuthCryptoAdapter,
    NodeSessionCryptoAdapter,
    {
      provide: ONE_TIME_TOKEN_CODEC,
      useExisting: NodeAccountLifecycleCryptoAdapter,
    },
    {
      provide: RoleRegistry,
      inject: [AUTH_ROLE_DEFINITIONS],
      useFactory: createAuthRoleRegistry,
    },
    PrismaAccountAdministrationReadAdapter,
    PrismaAccountAdministrationMutationAdapter,
    PrismaAccountProvisioningAdapter,
    PrismaEmailVerificationAdapter,
    PrismaInvitationAdapter,
    PrismaPasswordRecoveryAdapter,
    PrismaRegistrationAdapter,
    PrismaIdentitySecurityStateAdapter,
    PrismaPasswordCredentialAdapter,
    PrismaSessionGenerationAdapter,
    {
      provide: RedisSessionStore,
      inject: [
        REDIS_AUTH_COMMAND_EXECUTOR,
        NodeSessionCryptoAdapter,
        RuntimeConfigService,
      ],
      useFactory: (
        executor: RedisCommandExecutorPort,
        crypto: NodeSessionCryptoAdapter,
        config: RuntimeConfigService,
      ): RedisSessionStore =>
        new RedisSessionStore(executor, crypto, {
          keyPrefix: config.redis.keyPrefix,
          environment: config.environment,
          sessionKeySecret: config.auth.sessionKeySecret,
          csrfSecret: config.auth.csrfSecret,
          idleTimeoutMs: config.auth.sessionIdleTimeoutMs,
          absoluteTimeoutMs: config.auth.sessionAbsoluteTimeoutMs,
          touchIntervalMs: config.auth.sessionTouchIntervalMs,
        }),
    },
    {
      provide: RedisLoginRateLimiter,
      inject: [
        REDIS_AUTH_COMMAND_EXECUTOR,
        NodePasswordAuthCryptoAdapter,
        RuntimeConfigService,
      ],
      useFactory: (
        executor: RedisCommandExecutorPort,
        crypto: NodePasswordAuthCryptoAdapter,
        config: RuntimeConfigService,
      ): RedisLoginRateLimiter =>
        new RedisLoginRateLimiter(executor, crypto, {
          keyPrefix: config.redis.keyPrefix,
          environment: config.environment,
          hmacSecret: config.auth.rateLimitKeySecret,
          ipLimit: config.auth.loginIpLimit,
          accountLimit: config.auth.loginAccountLimit,
          windowMs: config.auth.loginWindowMs,
        }),
    },
    {
      provide: IDENTITY_SECURITY_STATE,
      useExisting: PrismaIdentitySecurityStateAdapter,
    },
    {
      provide: PASSWORD_CREDENTIALS,
      useExisting: PrismaPasswordCredentialAdapter,
    },
    {
      provide: SESSION_GENERATION,
      useExisting: PrismaSessionGenerationAdapter,
    },
    {
      provide: ACCOUNT_PROVISIONING,
      useExisting: PrismaAccountProvisioningAdapter,
    },
    {
      provide: REGISTRATION_PERSISTENCE,
      useExisting: PrismaRegistrationAdapter,
    },
    {
      provide: EMAIL_VERIFICATION_PERSISTENCE,
      useExisting: PrismaEmailVerificationAdapter,
    },
    {
      provide: PASSWORD_RECOVERY_PERSISTENCE,
      useExisting: PrismaPasswordRecoveryAdapter,
    },
    {
      provide: ACCOUNT_ADMINISTRATION_READ,
      useExisting: PrismaAccountAdministrationReadAdapter,
    },
    {
      provide: ACCOUNT_ADMINISTRATION_MUTATION,
      useExisting: PrismaAccountAdministrationMutationAdapter,
    },
    {
      provide: INVITATION_PERSISTENCE,
      useExisting: PrismaInvitationAdapter,
    },
    { provide: PASSWORD_HASHER, useExisting: Argon2PasswordHasher },
    { provide: LOGIN_RATE_LIMITER, useExisting: RedisLoginRateLimiter },
    { provide: SESSION_STORE, useExisting: RedisSessionStore },
    { provide: AUTH_AUDIT, useExisting: AuthAuditLogger },
    {
      provide: SelfServiceAuthPolicy,
      inject: [RuntimeConfigService],
      useFactory: (config: RuntimeConfigService): SelfServiceAuthPolicy =>
        new SelfServiceAuthPolicy({
          ...config.auth.selfService,
          emailWorkflowsEnabled:
            config.auth.accountEmailWorkflows.mode === 'enabled',
        }),
    },
    {
      provide: AccountAdministrationService,
      inject: [
        ACCOUNT_ADMINISTRATION_READ,
        ACCOUNT_ADMINISTRATION_MUTATION,
        RuntimeConfigService,
        RoleRegistry,
        SESSION_STORE,
        AUTH_SESSION_CLEANUP_OBSERVER,
        AUTH_AUDIT,
      ],
      useFactory: (
        queries: AccountAdministrationReadPort,
        mutations: AccountAdministrationMutationPort,
        config: RuntimeConfigService,
        roles: RoleRegistry,
        sessions: RedisSessionStore,
        cleanupObserver: AuthSessionCleanupObserver,
        audit: AuthAuditLogger,
      ): AccountAdministrationService =>
        new AccountAdministrationService(
          queries,
          mutations,
          config.auth.accountAdministration,
          roles,
          sessions,
          cleanupObserver,
          audit,
        ),
    },
    {
      provide: AccountEmailWorkflowsPolicy,
      inject: [RuntimeConfigService],
      useFactory: (config: RuntimeConfigService): AccountEmailWorkflowsPolicy =>
        new AccountEmailWorkflowsPolicy({
          ...config.auth.accountEmailWorkflows,
          passwordResetTtlMs: config.auth.selfService.passwordResetTtlMs,
          ...(config.auth.selfService.publicAppUrl === undefined
            ? {}
            : { publicAppUrl: config.auth.selfService.publicAppUrl }),
        }),
    },
    {
      provide: PUBLIC_AUTH_RATE_LIMITER,
      inject: [
        REDIS_AUTH_COMMAND_EXECUTOR,
        NodeAccountLifecycleCryptoAdapter,
        RuntimeConfigService,
      ],
      useFactory: (
        executor: RedisCommandExecutorPort,
        crypto: NodeAccountLifecycleCryptoAdapter,
        config: RuntimeConfigService,
      ): RedisPublicAuthRateLimiter =>
        new RedisPublicAuthRateLimiter(executor, crypto, {
          keyPrefix: config.redis.keyPrefix,
          environment: config.environment,
          hmacSecret: config.auth.rateLimitKeySecret,
          registrationIpLimit: config.auth.selfService.registrationIpLimit,
          registrationAccountLimit:
            config.auth.selfService.registrationAccountLimit,
          resendIpLimit: config.auth.selfService.resendIpLimit,
          resendAccountLimit: config.auth.selfService.resendAccountLimit,
          resetRequestIpLimit: config.auth.selfService.resetRequestIpLimit,
          resetRequestAccountLimit:
            config.auth.selfService.resetRequestAccountLimit,
          requestWindowMs: config.auth.selfService.requestWindowMs,
          resendCooldownMs: config.auth.selfService.resendCooldownMs,
        }),
    },
    {
      provide: AUTH_MAIL_DELIVERY,
      inject: [RuntimeConfigService],
      useFactory: (config: RuntimeConfigService): AuthMailDeliveryPort => {
        const selfService = config.auth.selfService
        if (
          selfService.mode !== 'open' &&
          config.auth.accountEmailWorkflows.mode !== 'enabled'
        ) {
          return {
            sendEmailVerification: () => Promise.resolve({ delivered: false }),
            sendPasswordReset: () => Promise.resolve({ delivered: false }),
            sendAccountInvitation: () => Promise.resolve({ delivered: false }),
          }
        }
        return new NodemailerAuthMailAdapter({
          smtpUrl: selfService.smtpUrl as string,
          mailFrom: selfService.mailFrom as string,
          timeoutMs: selfService.mailDeliveryTimeoutMs,
          security:
            config.environment === 'production' ? 'production' : 'local',
        })
      },
    },
    { provide: AUTH_DUMMY_PASSWORD_HASH, useValue: dummyPasswordHash },
    {
      provide: AUTH_SESSION_CLEANUP_OBSERVER,
      useValue: NOOP_AUTH_SESSION_CLEANUP_OBSERVER,
    },
    LoginUseCase,
    SessionIssuer,
    AuthenticateSessionUseCase,
    {
      provide: DOCS_ACCESS_POLICY,
      inject: [
        AuthenticateSessionUseCase,
        AuthAuditLogger,
        RuntimeConfigService,
      ],
      useFactory: (
        authenticate: AuthenticateSessionUseCase,
        audit: AuthAuditLogger,
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
    LogoutUseCase,
    GetCsrfTokenQuery,
    ListSessionsQuery,
    RevokeSessionUseCase,
    LogoutAllUseCase,
    ChangePasswordUseCase,
    RegisterUserUseCase,
    ResendEmailVerificationUseCase,
    ConfirmEmailVerificationUseCase,
    RequestPasswordResetUseCase,
    ConfirmPasswordResetUseCase,
    AccountEmailWorkflowsService,
    {
      provide: PublicAuthResponseDelay,
      inject: [RuntimeConfigService],
      useFactory: (config: RuntimeConfigService): PublicAuthResponseDelay =>
        new PublicAuthResponseDelay(
          config.auth.selfService.acceptedResponseFloorMs,
        ),
    },
    {
      provide: AuthCookieAdapter,
      inject: [RuntimeConfigService],
      useFactory: (config: RuntimeConfigService): AuthCookieAdapter =>
        new AuthCookieAdapter(
          config.auth.sessionCookieName,
          config.auth.secureCookie,
        ),
    },
    {
      provide: AUTH_LOGIN_METADATA_FACTORY,
      inject: [NodePasswordAuthCryptoAdapter, RuntimeConfigService],
      useFactory:
        (
          crypto: NodePasswordAuthCryptoAdapter,
          config: RuntimeConfigService,
        ): LoginRequestMetadataFactory =>
        ({ ipAddress, userAgent }) => ({
          deviceLabel:
            userAgent?.trim().replaceAll(/\s+/gu, ' ').slice(0, 160) ||
            'Unknown device',
          networkFingerprint: crypto.hmac(
            config.auth.networkMetadataSecret,
            ipAddress,
          ),
        }),
    },
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
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
    { provide: APP_GUARD, useExisting: BrowserOriginGuard },
    { provide: APP_GUARD, useExisting: SessionCsrfGuard },
    { provide: APP_GUARD, useExisting: PermissionGuard },
    { provide: APP_INTERCEPTOR, useExisting: AuthRequestInterceptor },
  ],
  exports: [Argon2PasswordHasher, DOCS_ACCESS_POLICY],
})
export class AuthModule {
  /**
   * Composes auth with one immutable snapshot of product-owned roles.
   *
   * @param options - Complete role catalog owned by the API composition root.
   * @returns Dynamic auth module whose registry cannot observe later input mutations.
   */
  public static forRoot(options: AuthModuleOptions): DynamicModule {
    const roleDefinitions = Object.freeze(
      options.roleDefinitions.map((definition) =>
        Object.freeze({
          key: definition.key,
          permissions: Object.freeze([...definition.permissions]),
        }),
      ),
    )
    return {
      module: AuthModule,
      providers: [
        {
          provide: AUTH_ROLE_DEFINITIONS,
          useValue: roleDefinitions,
        },
      ],
    }
  }
}
