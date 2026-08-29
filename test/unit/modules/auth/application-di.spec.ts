import { INJECTABLE_WATERMARK, MODULE_METADATA } from '@nestjs/common/constants'
import { Test } from '@nestjs/testing'

import {
  ACCOUNT_PROVISIONING,
  type AccountProvisioningPort,
} from '@/modules/auth/application/account-provisioning.port'
import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
} from '@/modules/auth/application/auth-audit.port'
import type { AuthMailDeliveryPort } from '@/modules/auth/application/auth-mail-delivery.port'
import { AUTH_MAIL_DELIVERY } from '@/modules/auth/application/auth-mail-delivery.port'
import { AUTH_DUMMY_PASSWORD_HASH } from '@/modules/auth/authentication/application/password-auth.tokens'
import {
  AUTH_SESSION_CLEANUP_OBSERVER,
  NOOP_AUTH_SESSION_CLEANUP_OBSERVER,
  SessionCleanupService,
  type AuthSessionCleanupObserver,
} from '@/modules/auth/sessions/application/session-cleanup.service'
import { AuthenticateSessionUseCase } from '@/modules/auth/application/authenticate-session.use-case'
import { ChangePasswordUseCase } from '@/modules/auth/authentication/application/change-password.use-case'
import { ConfirmEmailVerificationUseCase } from '@/modules/auth/application/confirm-email-verification.use-case'
import { ConfirmPasswordResetUseCase } from '@/modules/auth/application/confirm-password-reset.use-case'
import { CreateInitialAdminUseCase } from '@/modules/auth/application/create-initial-admin.use-case'
import { CreateUserUseCase } from '@/modules/auth/application/create-user.use-case'
import { GetCsrfTokenQuery } from '@/modules/auth/sessions/application/get-csrf-token.query'
import { GetMeQuery } from '@/modules/auth/application/get-me.query'
import {
  EMAIL_VERIFICATION_PERSISTENCE,
  type EmailVerificationPersistencePort,
} from '@/modules/auth/application/email-verification-persistence.port'
import {
  IDENTITY_SECURITY_STATE,
  type IdentitySecurityStatePort,
} from '@/modules/auth/identity/application/identity-security-state.port'
import {
  LOGIN_RATE_LIMITER,
  type LoginRateLimiterPort,
} from '@/modules/auth/authentication/application/login-rate-limiter.port'
import { ListSessionsQuery } from '@/modules/auth/sessions/application/list-sessions.query'
import { LoginUseCase } from '@/modules/auth/authentication/application/login.use-case'
import { LogoutAllUseCase } from '@/modules/auth/sessions/application/logout-all.use-case'
import { LogoutUseCase } from '@/modules/auth/sessions/application/logout.use-case'
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from '@/modules/auth/authentication/application/password-hasher.port'
import {
  PASSWORD_CREDENTIALS,
  type PasswordCredentialPort,
} from '@/modules/auth/authentication/application/password-credential.port'
import {
  PASSWORD_RECOVERY_PERSISTENCE,
  type PasswordRecoveryPersistencePort,
} from '@/modules/auth/application/password-recovery-persistence.port'
import type { PermissionKey } from '@/modules/auth/application/permission'
import { RevokeSessionUseCase } from '@/modules/auth/sessions/application/revoke-session.use-case'
import { ONE_TIME_TOKEN_CODEC } from '@/modules/auth/application/one-time-token-codec.port'
import { PUBLIC_AUTH_RATE_LIMITER } from '@/modules/auth/application/public-auth-rate-limiter.port'
import { RegisterUserUseCase } from '@/modules/auth/application/register-user.use-case'
import {
  REGISTRATION_PERSISTENCE,
  type RegistrationPersistencePort,
} from '@/modules/auth/application/registration-persistence.port'
import { RequestPasswordResetUseCase } from '@/modules/auth/application/request-password-reset.use-case'
import { ResendEmailVerificationUseCase } from '@/modules/auth/application/resend-email-verification.use-case'
import {
  createAuthRoleRegistry,
  RoleRegistry,
} from '@/modules/auth/application/role-registry'
import {
  SESSION_STORE,
  type SessionStorePort,
} from '@/modules/auth/sessions/application/session-store.port'
import {
  SESSION_GENERATION,
  type SessionGenerationPort,
} from '@/modules/auth/sessions/application/session-generation.port'
import { SessionIssuer } from '@/modules/auth/sessions/application/session-issuer'
import { ResolveSessionIdentityQuery } from '@/modules/auth/sessions/application/resolve-session-identity.query'
import type { AuthenticatedPrincipal } from '@/modules/auth/public-contracts/authenticated-principal'
import { PrismaAccountAdministrationMutationAdapter } from '@/modules/auth/account-administration/infrastructure/prisma-account-administration-mutation.adapter'
import { PrismaAccountAdministrationReadAdapter } from '@/modules/auth/account-administration/infrastructure/prisma-account-administration-read.adapter'
import { PrismaAccountProvisioningAdapter } from '@/modules/auth/account-administration/provisioning/infrastructure/prisma-account-provisioning.adapter'
import { PrismaEmailVerificationAdapter } from '@/modules/auth/account-lifecycle/email-verification/infrastructure/prisma-email-verification.adapter'
import { PrismaInvitationAdapter } from '@/modules/auth/account-lifecycle/invitations/infrastructure/prisma-invitation.adapter'
import { PrismaPasswordRecoveryAdapter } from '@/modules/auth/account-lifecycle/password-recovery/infrastructure/prisma-password-recovery.adapter'
import { PrismaRegistrationAdapter } from '@/modules/auth/account-lifecycle/registration/infrastructure/prisma-registration.adapter'
import { PrismaPasswordCredentialAdapter } from '@/modules/auth/authentication/infrastructure/prisma-password-credential.adapter'
import { PrismaIdentitySecurityStateAdapter } from '@/modules/auth/identity/infrastructure/prisma-identity-security-state.adapter'
import { Argon2PasswordHasher } from '@/modules/auth/authentication/infrastructure/argon2-password.hasher'
import { RedisLoginRateLimiter } from '@/modules/auth/authentication/infrastructure/redis-login-rate-limiter'
import { RedisSessionStore } from '@/modules/auth/sessions/infrastructure/redis-session.store'
import { PrismaSessionGenerationAdapter } from '@/modules/auth/sessions/infrastructure/prisma-session-generation.adapter'
import { AuthModule } from '@/modules/auth/composition/auth.module'
import { IdentityModule } from '@/modules/auth/identity/composition/identity.module'
import { SessionsModule } from '@/modules/auth/sessions/composition/sessions.module'
import { AuthenticationModule } from '@/modules/auth/authentication/composition/authentication.module'
import { SelfServiceAuthPolicy } from '@/modules/auth/application/self-service-auth.policy'
import type { OneTimeTokenCodecPort } from '@/modules/auth/application/one-time-token-codec.port'
import type { PublicAuthRateLimiterPort } from '@/modules/auth/application/public-auth-rate-limiter.port'

const applicationClasses = [
  AuthenticateSessionUseCase,
  ChangePasswordUseCase,
  ConfirmEmailVerificationUseCase,
  ConfirmPasswordResetUseCase,
  CreateInitialAdminUseCase,
  CreateUserUseCase,
  GetCsrfTokenQuery,
  GetMeQuery,
  ListSessionsQuery,
  LoginUseCase,
  LogoutAllUseCase,
  LogoutUseCase,
  RevokeSessionUseCase,
  RegisterUserUseCase,
  RequestPasswordResetUseCase,
  ResolveSessionIdentityQuery,
  ResendEmailVerificationUseCase,
  SessionCleanupService,
  SessionIssuer,
] as const

interface ProviderDefinition {
  readonly provide: unknown
  readonly useExisting?: unknown
  readonly useFactory?: unknown
  readonly useValue?: unknown
}

type AuthTestPersistence = AccountProvisioningPort &
  EmailVerificationPersistencePort &
  IdentitySecurityStatePort &
  PasswordCredentialPort &
  PasswordRecoveryPersistencePort &
  RegistrationPersistencePort &
  SessionGenerationPort

describe('auth application Nest dependency injection', () => {
  it('constructs runtime application classes directly through port tokens', async () => {
    const persistence: AuthTestPersistence = {
      bootstrapInitialAdmin: jest.fn(),
      changePasswordAndInvalidate: jest.fn(),
      createUser: jest.fn(),
      findAuthProjectionByUserId: jest.fn(),
      findCredentialByNormalizedEmail: jest.fn(),
      findCredentialByUserId: jest.fn(),
      incrementSessionGeneration: jest.fn(),
      readGlobalSessionEpoch: jest.fn(),
      replacePasswordIfVersion: jest.fn(),
      registerSelfServiceUser: jest.fn(),
      rotateEmailVerificationToken: jest.fn(),
      rotateAdministratorPasswordReset: jest.fn(),
      confirmEmailVerification: jest.fn(),
      rotatePasswordResetToken: jest.fn(),
      getEligiblePasswordResetTokenSource: jest.fn(),
      confirmPasswordReset: jest.fn(),
    }
    const passwords: PasswordHasherPort = {
      hash: jest.fn(),
      verify: jest.fn(),
    }
    const limiter: LoginRateLimiterPort = {
      consume: jest.fn(),
    }
    const listSessions: jest.MockedFunction<SessionStorePort['list']> = jest
      .fn()
      .mockResolvedValue([])
    const sessions: SessionStorePort = {
      csrfToken: jest.fn(),
      issue: jest.fn(),
      list: listSessions,
      readAndTouch: jest.fn(),
      revoke: jest.fn(),
      revokeAll: jest.fn(),
    }
    const cleanupObserver: AuthSessionCleanupObserver = {
      cleanupIncomplete: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      providers: [
        ...applicationClasses,
        { provide: ACCOUNT_PROVISIONING, useValue: persistence },
        { provide: EMAIL_VERIFICATION_PERSISTENCE, useValue: persistence },
        { provide: IDENTITY_SECURITY_STATE, useValue: persistence },
        { provide: PASSWORD_CREDENTIALS, useValue: persistence },
        { provide: PASSWORD_RECOVERY_PERSISTENCE, useValue: persistence },
        { provide: REGISTRATION_PERSISTENCE, useValue: persistence },
        { provide: SESSION_GENERATION, useValue: persistence },
        { provide: PASSWORD_HASHER, useValue: passwords },
        { provide: LOGIN_RATE_LIMITER, useValue: limiter },
        { provide: SESSION_STORE, useValue: sessions },
        { provide: AUTH_AUDIT, useValue: NOOP_AUTH_AUDIT },
        {
          provide: AUTH_SESSION_CLEANUP_OBSERVER,
          useValue: cleanupObserver,
        },
        { provide: AUTH_DUMMY_PASSWORD_HASH, useValue: 'dummy-hash' },
        { provide: RoleRegistry, useValue: createAuthRoleRegistry([]) },
        {
          provide: ONE_TIME_TOKEN_CODEC,
          useValue: {
            issue: jest.fn(),
            digest: jest.fn(),
          } as OneTimeTokenCodecPort,
        },
        {
          provide: PUBLIC_AUTH_RATE_LIMITER,
          useValue: { consume: jest.fn() } as PublicAuthRateLimiterPort,
        },
        {
          provide: AUTH_MAIL_DELIVERY,
          useValue: {
            sendEmailVerification: jest.fn(),
            sendPasswordReset: jest.fn(),
            sendAccountInvitation: jest.fn(),
          } as AuthMailDeliveryPort,
        },
        {
          provide: SelfServiceAuthPolicy,
          useValue: new SelfServiceAuthPolicy({
            mode: 'disabled',
            verificationTtlMs: 86_400_000,
            passwordResetTtlMs: 1_800_000,
          }),
        },
      ],
    }).compile()

    for (const applicationClass of applicationClasses) {
      expect(Reflect.getMetadata(INJECTABLE_WATERMARK, applicationClass)).toBe(
        true,
      )
      expect(moduleRef.get(applicationClass)).toBeInstanceOf(applicationClass)
    }

    const principal: AuthenticatedPrincipal = {
      userId: 'user-1',
      sessionId: 'session-1',
      normalizedEmail: 'admin@example.com',
      roleKeys: [],
      permissions: new Set<PermissionKey>(),
    }
    await expect(
      moduleRef.get(ListSessionsQuery).execute(principal),
    ).resolves.toEqual([])
    expect(listSessions).toHaveBeenCalledWith('user-1', 'session-1')

    await moduleRef.close()
  })

  it('composes capability modules with narrow exported tokens', () => {
    const providersOf = (module: object): readonly unknown[] =>
      (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) ??
        []) as readonly unknown[]
    const definitionsOf = (module: object): readonly ProviderDefinition[] =>
      providersOf(module).filter(
        (provider): provider is ProviderDefinition =>
          typeof provider === 'object' &&
          provider !== null &&
          'provide' in provider,
      )
    const authProviders = providersOf(AuthModule)
    const identityDefinitions = definitionsOf(IdentityModule)
    const sessionProviders = providersOf(SessionsModule)
    const sessionDefinitions = definitionsOf(SessionsModule)
    const authenticationProviders = providersOf(AuthenticationModule)
    const authenticationDefinitions = definitionsOf(AuthenticationModule)

    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AuthModule)).toEqual(
      expect.arrayContaining([
        IdentityModule,
        SessionsModule,
        AuthenticationModule,
      ]),
    )
    expect(authProviders).toEqual(
      expect.arrayContaining([
        AuthenticateSessionUseCase,
        PrismaAccountAdministrationMutationAdapter,
        PrismaAccountAdministrationReadAdapter,
        PrismaAccountProvisioningAdapter,
        PrismaEmailVerificationAdapter,
        PrismaInvitationAdapter,
        PrismaPasswordRecoveryAdapter,
        PrismaRegistrationAdapter,
      ]),
    )

    expect(identityDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: IDENTITY_SECURITY_STATE,
          useExisting: PrismaIdentitySecurityStateAdapter,
        }),
      ]),
    )
    expect(sessionProviders).toEqual(
      expect.arrayContaining([
        SessionIssuer,
        ResolveSessionIdentityQuery,
        SessionCleanupService,
        PrismaSessionGenerationAdapter,
      ]),
    )
    expect(sessionDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: SESSION_GENERATION,
          useExisting: PrismaSessionGenerationAdapter,
        }),
        expect.objectContaining({
          provide: SESSION_STORE,
          useExisting: RedisSessionStore,
        }),
      ]),
    )
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, SessionsModule),
    ).not.toContain(SESSION_STORE)
    expect(authenticationProviders).toEqual(
      expect.arrayContaining([
        LoginUseCase,
        ChangePasswordUseCase,
        PrismaPasswordCredentialAdapter,
        Argon2PasswordHasher,
      ]),
    )
    expect(authenticationDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: PASSWORD_CREDENTIALS,
          useExisting: PrismaPasswordCredentialAdapter,
        }),
        expect.objectContaining({
          provide: PASSWORD_HASHER,
          useExisting: Argon2PasswordHasher,
        }),
        expect.objectContaining({
          provide: LOGIN_RATE_LIMITER,
          useExisting: RedisLoginRateLimiter,
        }),
      ]),
    )
    expect(
      sessionDefinitions.find(
        ({ provide }) => provide === AUTH_SESSION_CLEANUP_OBSERVER,
      )?.useValue,
    ).toBe(NOOP_AUTH_SESSION_CLEANUP_OBSERVER)
    expect(
      typeof authenticationDefinitions.find(
        ({ provide }) => provide === AUTH_DUMMY_PASSWORD_HASH,
      )?.useValue,
    ).toBe('string')
  })
})
