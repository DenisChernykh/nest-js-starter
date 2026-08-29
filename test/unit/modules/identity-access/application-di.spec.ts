import { INJECTABLE_WATERMARK, MODULE_METADATA } from '@nestjs/common/constants'
import { Test } from '@nestjs/testing'

import {
  ACCOUNT_PROVISIONING,
  type AccountProvisioningPort,
} from '@/modules/identity-access/account-administration/provisioning/application/account-provisioning.port'
import { CreateInitialAdminUseCase } from '@/modules/identity-access/account-administration/provisioning/application/create-initial-admin.use-case'
import { CreateUserUseCase } from '@/modules/identity-access/account-administration/provisioning/application/create-user.use-case'
import { PROVISIONING_PASSWORD_HASHER } from '@/modules/identity-access/account-administration/provisioning/application/provisioning-password-hasher.port'
import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
} from '@/modules/identity-access/public-contracts/auth-audit.port'
import type { AuthMailDeliveryPort } from '@/modules/identity-access/account-lifecycle/application/auth-mail-delivery.port'
import { AUTH_MAIL_DELIVERY } from '@/modules/identity-access/account-lifecycle/application/auth-mail-delivery.port'
import { AUTH_DUMMY_PASSWORD_HASH } from '@/modules/identity-access/authentication/application/password-auth.tokens'
import {
  AUTH_SESSION_CLEANUP_OBSERVER,
  NOOP_AUTH_SESSION_CLEANUP_OBSERVER,
  SessionCleanupService,
  type AuthSessionCleanupObserver,
} from '@/modules/identity-access/sessions/application/session-cleanup.service'
import { AuthenticateSessionUseCase } from '@/modules/identity-access/authorization/application/authenticate-session.use-case'
import { ChangePasswordUseCase } from '@/modules/identity-access/authentication/application/change-password.use-case'
import { ConfirmEmailVerificationUseCase } from '@/modules/identity-access/account-lifecycle/email-verification/application/confirm-email-verification.use-case'
import { ConfirmPasswordResetUseCase } from '@/modules/identity-access/account-lifecycle/password-recovery/application/confirm-password-reset.use-case'
import { GetCsrfTokenQuery } from '@/modules/identity-access/sessions/application/get-csrf-token.query'
import { GetMeQuery } from '@/modules/identity-access/authorization/application/get-me.query'
import {
  EMAIL_VERIFICATION_PERSISTENCE,
  type EmailVerificationPersistencePort,
} from '@/modules/identity-access/account-lifecycle/email-verification/application/email-verification-persistence.port'
import {
  IDENTITY_SECURITY_STATE,
  type IdentitySecurityStatePort,
} from '@/modules/identity-access/identity/application/identity-security-state.port'
import {
  LOGIN_RATE_LIMITER,
  type LoginRateLimiterPort,
} from '@/modules/identity-access/authentication/application/login-rate-limiter.port'
import { ListSessionsQuery } from '@/modules/identity-access/sessions/application/list-sessions.query'
import { LoginUseCase } from '@/modules/identity-access/authentication/application/login.use-case'
import { LogoutAllUseCase } from '@/modules/identity-access/sessions/application/logout-all.use-case'
import { LogoutUseCase } from '@/modules/identity-access/sessions/application/logout.use-case'
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from '@/modules/identity-access/authentication/application/password-hasher.port'
import {
  PASSWORD_CREDENTIALS,
  type PasswordCredentialPort,
} from '@/modules/identity-access/authentication/application/password-credential.port'
import {
  PASSWORD_RECOVERY_PERSISTENCE,
  type PasswordRecoveryPersistencePort,
} from '@/modules/identity-access/account-lifecycle/password-recovery/application/password-recovery-persistence.port'
import type { PermissionKey } from '@/modules/identity-access/authorization/application/permission'
import { RevokeSessionUseCase } from '@/modules/identity-access/sessions/application/revoke-session.use-case'
import { ONE_TIME_TOKEN_CODEC } from '@/modules/identity-access/account-lifecycle/application/one-time-token-codec.port'
import { PUBLIC_AUTH_RATE_LIMITER } from '@/modules/identity-access/account-lifecycle/application/public-auth-rate-limiter.port'
import { RegisterUserUseCase } from '@/modules/identity-access/account-lifecycle/registration/application/register-user.use-case'
import {
  REGISTRATION_PERSISTENCE,
  type RegistrationPersistencePort,
} from '@/modules/identity-access/account-lifecycle/registration/application/registration-persistence.port'
import { RequestPasswordResetUseCase } from '@/modules/identity-access/account-lifecycle/password-recovery/application/request-password-reset.use-case'
import { ResendEmailVerificationUseCase } from '@/modules/identity-access/account-lifecycle/email-verification/application/resend-email-verification.use-case'
import {
  createAuthRoleRegistry,
  RoleRegistry,
} from '@/modules/identity-access/authorization/application/role-registry'
import {
  SESSION_STORE,
  type SessionStorePort,
} from '@/modules/identity-access/sessions/application/session-store.port'
import {
  SESSION_GENERATION,
  type SessionGenerationPort,
} from '@/modules/identity-access/sessions/application/session-generation.port'
import { SessionIssuer } from '@/modules/identity-access/sessions/application/session-issuer'
import { ResolveSessionIdentityQuery } from '@/modules/identity-access/sessions/application/resolve-session-identity.query'
import type { AuthenticatedPrincipal } from '@/modules/identity-access/public-contracts/authenticated-principal'
import { PrismaPasswordCredentialAdapter } from '@/modules/identity-access/authentication/infrastructure/prisma-password-credential.adapter'
import { PrismaIdentitySecurityStateAdapter } from '@/modules/identity-access/identity/infrastructure/prisma-identity-security-state.adapter'
import { Argon2PasswordHasher } from '@/modules/identity-access/authentication/infrastructure/argon2-password.hasher'
import { RedisLoginRateLimiter } from '@/modules/identity-access/authentication/infrastructure/redis-login-rate-limiter'
import { RedisSessionStore } from '@/modules/identity-access/sessions/infrastructure/redis-session.store'
import { PrismaSessionGenerationAdapter } from '@/modules/identity-access/sessions/infrastructure/prisma-session-generation.adapter'
import { IdentityModule } from '@/modules/identity-access/identity/composition/identity.module'
import { SessionsModule } from '@/modules/identity-access/sessions/composition/sessions.module'
import { AuthenticationModule } from '@/modules/identity-access/authentication/composition/authentication.module'
import { SelfServiceAuthPolicy } from '@/modules/identity-access/account-lifecycle/application/self-service-auth.policy'
import type { OneTimeTokenCodecPort } from '@/modules/identity-access/account-lifecycle/application/one-time-token-codec.port'
import type { PublicAuthRateLimiterPort } from '@/modules/identity-access/account-lifecycle/application/public-auth-rate-limiter.port'

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
      withinCredentialVersionFence: (_userId, operation) =>
        operation(undefined),
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
        { provide: PROVISIONING_PASSWORD_HASHER, useValue: passwords },
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
    const identityDefinitions = definitionsOf(IdentityModule)
    const sessionProviders = providersOf(SessionsModule)
    const sessionDefinitions = definitionsOf(SessionsModule)
    const authenticationProviders = providersOf(AuthenticationModule)
    const authenticationDefinitions = definitionsOf(AuthenticationModule)

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
