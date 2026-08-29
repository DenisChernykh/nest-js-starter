import { Module } from '@nestjs/common'

import { AUTH_AUDIT } from '../../application/auth-audit.port'
import { SessionsModule } from '../../sessions/composition/sessions.module'
import { ChangePasswordUseCase } from '../application/change-password.use-case'
import { LOGIN_RATE_LIMITER } from '../application/login-rate-limiter.port'
import { LoginUseCase } from '../application/login.use-case'
import { AUTH_DUMMY_PASSWORD_HASH } from '../application/password-auth.tokens'
import { PASSWORD_CREDENTIALS } from '../application/password-credential.port'
import { PASSWORD_HASHER } from '../application/password-hasher.port'
import { Argon2PasswordHasher } from '../infrastructure/argon2-password.hasher'
import { NodePasswordAuthCryptoAdapter } from '../infrastructure/node-password-auth-crypto.adapter'
import { PrismaPasswordCredentialAdapter } from '../infrastructure/prisma-password-credential.adapter'
import { RedisLoginRateLimiter } from '../infrastructure/redis-login-rate-limiter'
import {
  AUTH_LOGIN_METADATA_FACTORY,
  AuthenticationController,
  type LoginRequestMetadataFactory,
} from '../presentation/authentication.controller'
import { RuntimeConfigModule } from '@/platform/config/runtime-config.module'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { DatabaseModule } from '@/platform/database/database.module'
import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'
import { RedisModule } from '@/platform/redis/redis.module'
import { REDIS_AUTH_COMMAND_EXECUTOR } from '@/platform/redis/redis.tokens'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'

const dummyPasswordHash =
  '$argon2id$v=19$m=19456,p=1,t=2$AQEBAQEBAQEBAQEBAQEBAQ$89iZHLNRbRP/PDabySsV1BxlW1VfqedCPSqmvYANw2U'

@Module({
  imports: [SessionsModule, RuntimeConfigModule, DatabaseModule, RedisModule],
  controllers: [AuthenticationController],
  providers: [
    Argon2PasswordHasher,
    NodePasswordAuthCryptoAdapter,
    PrismaPasswordCredentialAdapter,
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
      provide: PASSWORD_CREDENTIALS,
      useExisting: PrismaPasswordCredentialAdapter,
    },
    { provide: PASSWORD_HASHER, useExisting: Argon2PasswordHasher },
    { provide: LOGIN_RATE_LIMITER, useExisting: RedisLoginRateLimiter },
    { provide: AUTH_AUDIT, useExisting: AuthAuditLogger },
    { provide: AUTH_DUMMY_PASSWORD_HASH, useValue: dummyPasswordHash },
    LoginUseCase,
    ChangePasswordUseCase,
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
  ],
  exports: [PASSWORD_HASHER],
})
export class AuthenticationModule {}
