import { Module, type DynamicModule } from '@nestjs/common'

import { AccountEmailWorkflowsPolicy } from '../application/account-email-workflows.policy'
import {
  AUTH_MAIL_DELIVERY,
  type AuthMailDeliveryPort,
} from '../application/auth-mail-delivery.port'
import { ONE_TIME_TOKEN_CODEC } from '../application/one-time-token-codec.port'
import { PUBLIC_AUTH_RATE_LIMITER } from '../application/public-auth-rate-limiter.port'
import { ConfirmEmailVerificationUseCase } from '../email-verification/application/confirm-email-verification.use-case'
import { EMAIL_VERIFICATION_PERSISTENCE } from '../email-verification/application/email-verification-persistence.port'
import { ResendEmailVerificationUseCase } from '../email-verification/application/resend-email-verification.use-case'
import { PrismaEmailVerificationAdapter } from '../email-verification/infrastructure/prisma-email-verification.adapter'
import { EmailVerificationController } from '../email-verification/presentation/email-verification.controller'
import { NodeAccountLifecycleCryptoAdapter } from '../infrastructure/node-account-lifecycle-crypto.adapter'
import { NodemailerAuthMailAdapter } from '../infrastructure/nodemailer-auth-mail.adapter'
import { RedisPublicAuthRateLimiter } from '../infrastructure/redis-public-auth-rate-limiter'
import { AcceptAccountInvitationUseCase } from '../invitations/application/accept-account-invitation.use-case'
import { CreateAccountInvitationUseCase } from '../invitations/application/create-account-invitation.use-case'
import { INVITATION_PERSISTENCE } from '../invitations/application/invitation-persistence.port'
import { ResendAccountInvitationUseCase } from '../invitations/application/resend-account-invitation.use-case'
import { PrismaInvitationAdapter } from '../invitations/infrastructure/prisma-invitation.adapter'
import { AccountInvitationsController } from '../invitations/presentation/account-invitations.controller'
import { AdminAccountInvitationsController } from '../invitations/presentation/admin-account-invitations.controller'
import { ConfirmPasswordResetUseCase } from '../password-recovery/application/confirm-password-reset.use-case'
import { PASSWORD_RECOVERY_PERSISTENCE } from '../password-recovery/application/password-recovery-persistence.port'
import { RequestAdministratorPasswordResetUseCase } from '../password-recovery/application/request-administrator-password-reset.use-case'
import { RequestPasswordResetUseCase } from '../password-recovery/application/request-password-reset.use-case'
import { PrismaPasswordRecoveryAdapter } from '../password-recovery/infrastructure/prisma-password-recovery.adapter'
import { AdminPasswordRecoveryController } from '../password-recovery/presentation/admin-password-recovery.controller'
import { PasswordRecoveryController } from '../password-recovery/presentation/password-recovery.controller'
import { PublicAuthResponseDelay } from '../presentation/public-auth-response-delay'
import { RegisterUserUseCase } from '../registration/application/register-user.use-case'
import { REGISTRATION_PERSISTENCE } from '../registration/application/registration-persistence.port'
import { PrismaRegistrationAdapter } from '../registration/infrastructure/prisma-registration.adapter'
import { RegistrationController } from '../registration/presentation/registration.controller'
import { AUTH_AUDIT } from '../../public-contracts/auth-audit.port'
import { AuthenticationModule } from '../../authentication/composition/authentication.module'
import type { ConfiguredAuthorizationModule } from '../../authorization/composition/authorization.module'
import { SessionsModule } from '../../sessions/composition/sessions.module'
import { SelfServiceAuthPolicy } from '../application/self-service-auth.policy'
import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { DatabaseModule } from '@/platform/database/database.module'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'
import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'
import { RedisModule } from '@/platform/redis/redis.module'
import { REDIS_AUTH_COMMAND_EXECUTOR } from '@/platform/redis/redis.tokens'

@Module({})
export class AccountLifecycleModule {
  public static register(
    authorizationModule: ConfiguredAuthorizationModule,
  ): DynamicModule {
    return {
      module: AccountLifecycleModule,
      imports: [
        authorizationModule,
        AuthenticationModule,
        SessionsModule,
        RuntimeConfigModule,
        DatabaseModule,
        RedisModule,
      ],
      controllers: [
        RegistrationController,
        EmailVerificationController,
        PasswordRecoveryController,
        AccountInvitationsController,
        AdminAccountInvitationsController,
        AdminPasswordRecoveryController,
      ],
      providers: [
        NodeAccountLifecycleCryptoAdapter,
        {
          provide: ONE_TIME_TOKEN_CODEC,
          useExisting: NodeAccountLifecycleCryptoAdapter,
        },
        PrismaRegistrationAdapter,
        PrismaEmailVerificationAdapter,
        PrismaPasswordRecoveryAdapter,
        PrismaInvitationAdapter,
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
          provide: AccountEmailWorkflowsPolicy,
          inject: [RuntimeConfigService],
          useFactory: (
            config: RuntimeConfigService,
          ): AccountEmailWorkflowsPolicy =>
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
                sendEmailVerification: () =>
                  Promise.resolve({ delivered: false }),
                sendPasswordReset: () => Promise.resolve({ delivered: false }),
                sendAccountInvitation: () =>
                  Promise.resolve({ delivered: false }),
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
        CreateAccountInvitationUseCase,
        ResendAccountInvitationUseCase,
        RequestAdministratorPasswordResetUseCase,
        AcceptAccountInvitationUseCase,
        {
          provide: PublicAuthResponseDelay,
          inject: [RuntimeConfigService],
          useFactory: (config: RuntimeConfigService): PublicAuthResponseDelay =>
            new PublicAuthResponseDelay(
              config.auth.selfService.acceptedResponseFloorMs,
            ),
        },
      ],
    }
  }
}
