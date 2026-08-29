import type { RuntimeEnvironment } from '@/platform/config/runtime-config.types'
import type { RedisCommandExecutorPort } from '@/platform/redis/redis-command.executor'
import { RedisKeyBuilder } from '@/platform/redis/redis-key.builder'
import { RedisScriptRunner } from '@/platform/redis/redis-script.runner'

import { AuthDependencyUnavailableError } from '../application/auth-errors'
import type {
  PublicAuthOperation,
  PublicAuthRateLimiterPort,
} from '../application/public-auth-rate-limiter.port'
import { PUBLIC_AUTH_RATE_LIMIT_SCRIPT } from './redis-public-auth-rate-limiter.scripts'

export interface PublicAccountRateLimitKeyDigestPort {
  hmac(key: Uint8Array, value: string): string
}

export interface RedisPublicAuthRateLimiterConfig {
  readonly keyPrefix: string
  readonly environment: RuntimeEnvironment
  readonly hmacSecret: Uint8Array
  readonly registrationIpLimit: number
  readonly registrationAccountLimit: number
  readonly resendIpLimit: number
  readonly resendAccountLimit: number
  readonly resetRequestIpLimit: number
  readonly resetRequestAccountLimit: number
  readonly requestWindowMs: number
  readonly resendCooldownMs: number
}

export class RedisPublicAuthRateLimiter implements PublicAuthRateLimiterPort {
  private readonly keys: RedisKeyBuilder
  private readonly scripts: RedisScriptRunner

  public constructor(
    executor: RedisCommandExecutorPort,
    private readonly crypto: PublicAccountRateLimitKeyDigestPort,
    private readonly config: RedisPublicAuthRateLimiterConfig,
  ) {
    const limits = [
      config.registrationIpLimit,
      config.registrationAccountLimit,
      config.resendIpLimit,
      config.resendAccountLimit,
      config.resetRequestIpLimit,
      config.resetRequestAccountLimit,
      config.requestWindowMs,
      config.resendCooldownMs,
    ]
    if (limits.some((value) => !Number.isSafeInteger(value) || value < 1)) {
      throw new Error('Redis public auth limiter policy is invalid')
    }
    this.keys = new RedisKeyBuilder(
      [config.keyPrefix, config.environment, 'auth', 'public'],
      'v1',
    )
    this.scripts = new RedisScriptRunner(executor)
    this.scripts.register(PUBLIC_AUTH_RATE_LIMIT_SCRIPT)
  }

  public async consume(input: {
    readonly operation: PublicAuthOperation
    readonly ipAddress: string
    readonly normalizedEmail: string
  }): Promise<
    | { readonly allowed: true }
    | { readonly allowed: false; readonly retryAfterMs: number }
  > {
    const ipDigest = this.crypto.hmac(
      this.config.hmacSecret,
      `ip:${input.ipAddress}`,
    )
    const accountDigest = this.crypto.hmac(
      this.config.hmacSecret,
      `account:${input.normalizedEmail}`,
    )
    const limits = operationLimits(input.operation, this.config)
    try {
      const response = await this.scripts.run<readonly [number, number]>(
        'auth-public-rate-limit-v1',
        [
          this.keys.build(input.operation, 'ip', ipDigest),
          this.keys.build(input.operation, 'account', accountDigest),
          this.keys.build(input.operation, 'cooldown', accountDigest),
        ],
        [
          String(limits.ipLimit),
          String(limits.accountLimit),
          String(this.config.requestWindowMs),
          String(limits.cooldownMs),
        ],
      )
      const allowed = Number(response[0]) === 1
      if (allowed) return { allowed: true }
      const retryAfterMs = Number(response[1])
      if (
        !Number.isSafeInteger(retryAfterMs) ||
        retryAfterMs < 1 ||
        retryAfterMs > this.config.requestWindowMs
      ) {
        throw new Error('Redis public limiter returned an invalid deadline')
      }
      return { allowed: false, retryAfterMs }
    } catch (error: unknown) {
      if (error instanceof AuthDependencyUnavailableError) throw error
      throw new AuthDependencyUnavailableError()
    }
  }
}

function operationLimits(
  operation: PublicAuthOperation,
  config: RedisPublicAuthRateLimiterConfig,
): {
  readonly ipLimit: number
  readonly accountLimit: number
  readonly cooldownMs: number
} {
  if (operation === 'register') {
    return {
      ipLimit: config.registrationIpLimit,
      accountLimit: config.registrationAccountLimit,
      cooldownMs: 0,
    }
  }
  if (operation === 'email-verification-resend') {
    return {
      ipLimit: config.resendIpLimit,
      accountLimit: config.resendAccountLimit,
      cooldownMs: config.resendCooldownMs,
    }
  }
  return {
    ipLimit: config.resetRequestIpLimit,
    accountLimit: config.resetRequestAccountLimit,
    cooldownMs: config.resendCooldownMs,
  }
}
