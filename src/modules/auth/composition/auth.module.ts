import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core'

import { AuthenticateSessionUseCase } from '../application/authenticate-session.use-case'
import { ChangePasswordUseCase } from '../application/change-password.use-case'
import { GetCsrfTokenQuery } from '../application/get-csrf-token.query'
import { GetMeQuery } from '../application/get-me.query'
import { ListSessionsQuery } from '../application/list-sessions.query'
import { LoginUseCase } from '../application/login.use-case'
import { LogoutAllUseCase } from '../application/logout-all.use-case'
import { LogoutUseCase } from '../application/logout.use-case'
import {
  createAuthRoleRegistry,
  RoleRegistry,
} from '../application/role-registry'
import { RevokeSessionUseCase } from '../application/revoke-session.use-case'
import { Argon2PasswordHasher } from '../infrastructure/argon2-password.hasher'
import { NodeAuthCryptoAdapter } from '../infrastructure/node-auth-crypto.adapter'
import { PrismaAuthRepository } from '../infrastructure/prisma-auth.repository'
import { RedisLoginRateLimiter } from '../infrastructure/redis-login-rate-limiter'
import { RedisSessionStore } from '../infrastructure/redis-session.store'
import { AuthCookieAdapter } from '../presentation/auth-cookie.adapter'
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
import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { DatabaseModule } from '@/platform/database/database.module'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'
import { RedisModule } from '@/platform/redis/redis.module'
import { REDIS_COORDINATION_COMMAND_EXECUTOR } from '@/platform/redis/redis.tokens'
import {
  TRANSACTION_PORT,
  type TransactionPort,
} from '@/shared/application/transaction.port'
import {
  DOCS_ACCESS_POLICY,
  type DocsAccessPolicy,
} from '@/platform/http/docs/docs-access.contracts'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'

const dummyPasswordHash =
  '$argon2id$v=19$m=19456,p=1,t=2$AQEBAQEBAQEBAQEBAQEBAQ$89iZHLNRbRP/PDabySsV1BxlW1VfqedCPSqmvYANw2U'

/** Composes durable identity, Redis sessions and ordered browser policy. */
@Module({
  imports: [RuntimeConfigModule, DatabaseModule, RedisModule],
  controllers: [AuthController],
  providers: [
    AuthRequestContext,
    GetMeQuery,
    Argon2PasswordHasher,
    NodeAuthCryptoAdapter,
    { provide: RoleRegistry, useFactory: createAuthRoleRegistry },
    {
      provide: PrismaAuthRepository,
      inject: [PrismaClientProvider, TRANSACTION_PORT],
      useFactory: (
        provider: PrismaClientProvider,
        transaction: TransactionPort,
      ): PrismaAuthRepository =>
        new PrismaAuthRepository(provider, transaction),
    },
    {
      provide: RedisSessionStore,
      inject: [
        REDIS_COORDINATION_COMMAND_EXECUTOR,
        NodeAuthCryptoAdapter,
        RuntimeConfigService,
      ],
      useFactory: (
        executor: RedisCommandExecutorPort,
        crypto: NodeAuthCryptoAdapter,
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
        REDIS_COORDINATION_COMMAND_EXECUTOR,
        NodeAuthCryptoAdapter,
        RuntimeConfigService,
      ],
      useFactory: (
        executor: RedisCommandExecutorPort,
        crypto: NodeAuthCryptoAdapter,
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
      provide: LoginUseCase,
      inject: [
        PrismaAuthRepository,
        Argon2PasswordHasher,
        RedisLoginRateLimiter,
        RedisSessionStore,
        AuthAuditLogger,
      ],
      useFactory: (
        persistence: PrismaAuthRepository,
        passwords: Argon2PasswordHasher,
        limiter: RedisLoginRateLimiter,
        sessions: RedisSessionStore,
        audit: AuthAuditLogger,
      ): LoginUseCase =>
        new LoginUseCase(
          persistence,
          passwords,
          limiter,
          sessions,
          dummyPasswordHash,
          audit,
        ),
    },
    {
      provide: AuthenticateSessionUseCase,
      inject: [RedisSessionStore, PrismaAuthRepository, RoleRegistry],
      useFactory: (
        sessions: RedisSessionStore,
        persistence: PrismaAuthRepository,
        roles: RoleRegistry,
      ): AuthenticateSessionUseCase =>
        new AuthenticateSessionUseCase(sessions, persistence, roles),
    },
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
    {
      provide: LogoutUseCase,
      inject: [RedisSessionStore, AuthAuditLogger],
      useFactory: (
        sessions: RedisSessionStore,
        audit: AuthAuditLogger,
      ): LogoutUseCase => new LogoutUseCase(sessions, audit),
    },
    {
      provide: GetCsrfTokenQuery,
      inject: [RedisSessionStore],
      useFactory: (sessions: RedisSessionStore): GetCsrfTokenQuery =>
        new GetCsrfTokenQuery(sessions),
    },
    {
      provide: ListSessionsQuery,
      inject: [RedisSessionStore],
      useFactory: (sessions: RedisSessionStore): ListSessionsQuery =>
        new ListSessionsQuery(sessions),
    },
    {
      provide: RevokeSessionUseCase,
      inject: [RedisSessionStore, AuthAuditLogger],
      useFactory: (
        sessions: RedisSessionStore,
        audit: AuthAuditLogger,
      ): RevokeSessionUseCase => new RevokeSessionUseCase(sessions, audit),
    },
    {
      provide: LogoutAllUseCase,
      inject: [
        PrismaAuthRepository,
        TRANSACTION_PORT,
        RedisSessionStore,
        AuthAuditLogger,
      ],
      useFactory: (
        persistence: PrismaAuthRepository,
        transaction: TransactionPort,
        sessions: RedisSessionStore,
        audit: AuthAuditLogger,
      ): LogoutAllUseCase =>
        new LogoutAllUseCase(
          persistence,
          transaction,
          sessions,
          undefined,
          audit,
        ),
    },
    {
      provide: ChangePasswordUseCase,
      inject: [
        PrismaAuthRepository,
        Argon2PasswordHasher,
        TRANSACTION_PORT,
        RedisSessionStore,
        AuthAuditLogger,
      ],
      useFactory: (
        persistence: PrismaAuthRepository,
        passwords: Argon2PasswordHasher,
        transaction: TransactionPort,
        sessions: RedisSessionStore,
        audit: AuthAuditLogger,
      ): ChangePasswordUseCase =>
        new ChangePasswordUseCase(
          persistence,
          passwords,
          transaction,
          sessions,
          undefined,
          audit,
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
      inject: [NodeAuthCryptoAdapter, RuntimeConfigService],
      useFactory:
        (
          crypto: NodeAuthCryptoAdapter,
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
  exports: [PrismaAuthRepository, Argon2PasswordHasher, DOCS_ACCESS_POLICY],
})
export class AuthModule {}
