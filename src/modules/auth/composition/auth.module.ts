import { Module, type DynamicModule } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'

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
import { ConfirmEmailVerificationUseCase } from '../application/confirm-email-verification.use-case'
import { ConfirmPasswordResetUseCase } from '../application/confirm-password-reset.use-case'
import { EMAIL_VERIFICATION_PERSISTENCE } from '../application/email-verification-persistence.port'
import { INVITATION_PERSISTENCE } from '../application/invitation-persistence.port'
import { PASSWORD_RECOVERY_PERSISTENCE } from '../application/password-recovery-persistence.port'
import { ONE_TIME_TOKEN_CODEC } from '../application/one-time-token-codec.port'
import { PUBLIC_AUTH_RATE_LIMITER } from '../application/public-auth-rate-limiter.port'
import { REGISTRATION_PERSISTENCE } from '../application/registration-persistence.port'
import { RegisterUserUseCase } from '../application/register-user.use-case'
import { RequestPasswordResetUseCase } from '../application/request-password-reset.use-case'
import { ResendEmailVerificationUseCase } from '../application/resend-email-verification.use-case'
import { SelfServiceAuthPolicy } from '../application/self-service-auth.policy'
import { PrismaAccountAdministrationMutationAdapter } from '../account-administration/infrastructure/prisma-account-administration-mutation.adapter'
import { PrismaAccountAdministrationReadAdapter } from '../account-administration/infrastructure/prisma-account-administration-read.adapter'
import { PrismaAccountProvisioningAdapter } from '../account-administration/provisioning/infrastructure/prisma-account-provisioning.adapter'
import { PrismaEmailVerificationAdapter } from '../account-lifecycle/email-verification/infrastructure/prisma-email-verification.adapter'
import { PrismaInvitationAdapter } from '../account-lifecycle/invitations/infrastructure/prisma-invitation.adapter'
import { NodeAccountLifecycleCryptoAdapter } from '../account-lifecycle/infrastructure/node-account-lifecycle-crypto.adapter'
import { PrismaPasswordRecoveryAdapter } from '../account-lifecycle/password-recovery/infrastructure/prisma-password-recovery.adapter'
import { PrismaRegistrationAdapter } from '../account-lifecycle/registration/infrastructure/prisma-registration.adapter'
import { AuthenticationModule } from '../authentication/composition/authentication.module'
import {
  AuthorizationModule,
  type ConfiguredAuthorizationModule,
} from '../authorization/composition/authorization.module'
import {
  RoleRegistry,
  type RoleDefinition,
} from '../authorization/application/role-registry'
import { AuthRequestInterceptor } from '../authorization/presentation/auth-request.interceptor'
import { AuthenticationGuard } from '../authorization/presentation/authentication.guard'
import { BrowserOriginGuard } from '../authorization/presentation/browser-origin.guard'
import { PermissionGuard } from '../authorization/presentation/permission.guard'
import { SessionCsrfGuard } from '../authorization/presentation/session-csrf.guard'
import { IdentityModule } from '../identity/composition/identity.module'
import { NodemailerAuthMailAdapter } from '../infrastructure/nodemailer-auth-mail.adapter'
import { RedisPublicAuthRateLimiter } from '../infrastructure/redis-public-auth-rate-limiter'
import { SessionCleanupService } from '../sessions/application/session-cleanup.service'
import { SessionsModule } from '../sessions/composition/sessions.module'
import { AdminAccountController } from '../presentation/admin-account.controller'
import { AdminAccountEmailWorkflowsController } from '../presentation/admin-account-email-workflows.controller'
import { AccountEmailWorkflowsController } from '../presentation/account-email-workflows.controller'
import { PublicAuthResponseDelay } from '../presentation/public-auth-response-delay'
import { SelfServiceAuthController } from '../presentation/self-service-auth.controller'
import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { DatabaseModule } from '@/platform/database/database.module'
import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'
import { RedisModule } from '@/platform/redis/redis.module'
import { REDIS_AUTH_COMMAND_EXECUTOR } from '@/platform/redis/redis.tokens'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'

/** Product-owned role catalog required to compose the auth capability. */
export interface AuthModuleOptions {
  readonly roleDefinitions: readonly RoleDefinition[]
}

/** Composes durable identity, Redis sessions and ordered browser policy. */
@Module({
  imports: [
    IdentityModule,
    SessionsModule,
    AuthenticationModule,
    RuntimeConfigModule,
    DatabaseModule,
    RedisModule,
  ],
  controllers: [
    SelfServiceAuthController,
    AdminAccountController,
    AdminAccountEmailWorkflowsController,
    AccountEmailWorkflowsController,
  ],
  providers: [
    NodeAccountLifecycleCryptoAdapter,
    {
      provide: ONE_TIME_TOKEN_CODEC,
      useExisting: NodeAccountLifecycleCryptoAdapter,
    },
    PrismaAccountAdministrationReadAdapter,
    PrismaAccountAdministrationMutationAdapter,
    PrismaAccountProvisioningAdapter,
    PrismaEmailVerificationAdapter,
    PrismaInvitationAdapter,
    PrismaPasswordRecoveryAdapter,
    PrismaRegistrationAdapter,
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
        SessionCleanupService,
        AUTH_AUDIT,
      ],
      useFactory: (
        queries: AccountAdministrationReadPort,
        mutations: AccountAdministrationMutationPort,
        config: RuntimeConfigService,
        roles: RoleRegistry,
        sessionCleanup: SessionCleanupService,
        audit: AuthAuditLogger,
      ): AccountAdministrationService =>
        new AccountAdministrationService(
          queries,
          mutations,
          config.auth.accountAdministration,
          roles,
          sessionCleanup,
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
  ],
  exports: [AuthenticationModule],
})
export class AuthModule {
  /**
   * Composes auth with one immutable snapshot of product-owned roles.
   *
   * @param options - Complete role catalog owned by the API composition root.
   * @returns Dynamic auth module whose registry cannot observe later input mutations.
   */
  public static forRoot(options: AuthModuleOptions): DynamicModule {
    const authorizationModule: ConfiguredAuthorizationModule =
      AuthorizationModule.forRoot(options.roleDefinitions)

    return {
      module: AuthModule,
      imports: [authorizationModule],
      providers: [
        { provide: APP_GUARD, useExisting: AuthenticationGuard },
        { provide: APP_GUARD, useExisting: BrowserOriginGuard },
        { provide: APP_GUARD, useExisting: SessionCsrfGuard },
        { provide: APP_GUARD, useExisting: PermissionGuard },
        { provide: APP_INTERCEPTOR, useExisting: AuthRequestInterceptor },
      ],
      exports: [authorizationModule],
    }
  }
}
