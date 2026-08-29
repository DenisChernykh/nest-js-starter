import { Module } from '@nestjs/common'

import { AUTH_AUDIT } from '../../public-contracts/auth-audit.port'
import { IdentityModule } from '../../identity/composition/identity.module'
import { GetCsrfTokenQuery } from '../application/get-csrf-token.query'
import { ListSessionsQuery } from '../application/list-sessions.query'
import { LogoutAllUseCase } from '../application/logout-all.use-case'
import { LogoutUseCase } from '../application/logout.use-case'
import { ResolveSessionIdentityQuery } from '../application/resolve-session-identity.query'
import { RevokeSessionUseCase } from '../application/revoke-session.use-case'
import {
  AUTH_SESSION_CLEANUP_OBSERVER,
  NOOP_AUTH_SESSION_CLEANUP_OBSERVER,
  SessionCleanupService,
} from '../application/session-cleanup.service'
import { SESSION_GENERATION } from '../application/session-generation.port'
import { SessionIssuer } from '../application/session-issuer'
import { SESSION_STORE } from '../application/session-store.port'
import { NodeSessionCryptoAdapter } from '../infrastructure/node-session-crypto.adapter'
import { PrismaSessionGenerationAdapter } from '../infrastructure/prisma-session-generation.adapter'
import { RedisSessionStore } from '../infrastructure/redis-session.store'
import { AuthCookieAdapter } from '../presentation/auth-cookie.adapter'
import { SessionsController } from '../presentation/sessions.controller'
import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { DatabaseModule } from '@/platform/database/database.module'
import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'
import { RedisModule } from '@/platform/redis/redis.module'
import { REDIS_AUTH_COMMAND_EXECUTOR } from '@/platform/redis/redis.tokens'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'

@Module({
  imports: [IdentityModule, RuntimeConfigModule, DatabaseModule, RedisModule],
  controllers: [SessionsController],
  providers: [
    NodeSessionCryptoAdapter,
    PrismaSessionGenerationAdapter,
    {
      provide: SESSION_GENERATION,
      useExisting: PrismaSessionGenerationAdapter,
    },
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
    { provide: SESSION_STORE, useExisting: RedisSessionStore },
    { provide: AUTH_AUDIT, useExisting: AuthAuditLogger },
    {
      provide: AUTH_SESSION_CLEANUP_OBSERVER,
      useValue: NOOP_AUTH_SESSION_CLEANUP_OBSERVER,
    },
    SessionCleanupService,
    SessionIssuer,
    ResolveSessionIdentityQuery,
    LogoutUseCase,
    GetCsrfTokenQuery,
    ListSessionsQuery,
    RevokeSessionUseCase,
    LogoutAllUseCase,
    {
      provide: AuthCookieAdapter,
      inject: [RuntimeConfigService],
      useFactory: (config: RuntimeConfigService): AuthCookieAdapter =>
        new AuthCookieAdapter(
          config.auth.sessionCookieName,
          config.auth.secureCookie,
        ),
    },
  ],
  exports: [
    AuthCookieAdapter,
    GetCsrfTokenQuery,
    ResolveSessionIdentityQuery,
    SessionCleanupService,
    SessionIssuer,
  ],
})
export class SessionsModule {}
