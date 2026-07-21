import type { RuntimeEnvironment } from '@/platform/config/runtime-config.types'
import type { RedisCapabilityExecutor } from '@/platform/redis/redis-capability'
import { RedisKeyBuilder } from '@/platform/redis/redis-key.builder'
import { RedisScriptRunner } from '@/platform/redis/redis-script.runner'

import { AuthDependencyUnavailableError } from '../application/auth-errors'
import type {
  LoginRateLimitDecision,
  LoginRateLimitInput,
  LoginRateLimiterPort,
} from '../application/login-rate-limiter.port'
import type { NodeAuthCryptoAdapter } from './node-auth-crypto.adapter'

/** Atomic Lua definition for both keyed login limiter buckets. */
export const LOGIN_RATE_LIMIT_SCRIPT = Object.freeze({
  name: 'auth-login-rate-limit-v1',
  source: `
local ip_count = redis.call('INCR', KEYS[1])
local account_count = redis.call('INCR', KEYS[2])
local window_ms = tonumber(ARGV[3])
if ip_count == 1 then redis.call('PEXPIRE', KEYS[1], window_ms) end
if account_count == 1 then redis.call('PEXPIRE', KEYS[2], window_ms) end
local ip_ttl = redis.call('PTTL', KEYS[1])
local account_ttl = redis.call('PTTL', KEYS[2])
if ip_ttl < 0 then redis.call('PEXPIRE', KEYS[1], window_ms); ip_ttl = window_ms end
if account_ttl < 0 then redis.call('PEXPIRE', KEYS[2], window_ms); account_ttl = window_ms end
local allowed = ip_count <= tonumber(ARGV[1]) and account_count <= tonumber(ARGV[2])
if allowed then return {1, 0} end
local retry_after = 0
if ip_count > tonumber(ARGV[1]) then retry_after = math.max(retry_after, ip_ttl) end
if account_count > tonumber(ARGV[2]) then retry_after = math.max(retry_after, account_ttl) end
return {0, retry_after}
`,
})

/** Namespace, HMAC key and finite limits for distributed login throttling. */
export interface RedisLoginRateLimiterConfig {
  readonly keyPrefix: string
  readonly environment: RuntimeEnvironment
  readonly hmacSecret: Uint8Array
  readonly ipLimit: number
  readonly accountLimit: number
  readonly windowMs: number
}

/** Fail-closed standalone-Redis implementation of atomic login throttling. */
export class RedisLoginRateLimiter implements LoginRateLimiterPort {
  private readonly keys: RedisKeyBuilder
  private readonly scripts: RedisScriptRunner

  public constructor(
    executor: RedisCapabilityExecutor,
    private readonly crypto: NodeAuthCryptoAdapter,
    private readonly config: RedisLoginRateLimiterConfig,
  ) {
    if (
      !Number.isSafeInteger(config.ipLimit) ||
      !Number.isSafeInteger(config.accountLimit) ||
      !Number.isSafeInteger(config.windowMs) ||
      config.ipLimit < 1 ||
      config.accountLimit < 1 ||
      config.windowMs < 1
    ) {
      throw new Error('Redis login limiter policy is invalid')
    }
    this.keys = new RedisKeyBuilder(
      [config.keyPrefix, config.environment, 'coordination'],
      'v1',
    )
    this.scripts = new RedisScriptRunner(executor)
    this.scripts.register(LOGIN_RATE_LIMIT_SCRIPT)
  }

  public async consume(
    input: LoginRateLimitInput,
  ): Promise<LoginRateLimitDecision> {
    const ipDigest = this.crypto.hmac(
      this.config.hmacSecret,
      `ip:${input.ipAddress}`,
    )
    const accountDigest = this.crypto.hmac(
      this.config.hmacSecret,
      `account:${input.normalizedEmail}`,
    )
    try {
      const response = await this.scripts.run<[number, number]>(
        'auth-login-rate-limit-v1',
        [
          this.keys.build('login-rate-ip', ipDigest),
          this.keys.build('login-rate-account', accountDigest),
        ],
        [
          String(this.config.ipLimit),
          String(this.config.accountLimit),
          String(this.config.windowMs),
        ],
      )
      const allowed = response[0] === 1
      if (allowed) return { allowed: true }
      const retryAfterMs = response[1]
      if (
        retryAfterMs === undefined ||
        retryAfterMs < 1 ||
        retryAfterMs > this.config.windowMs
      ) {
        throw new Error('Redis limiter returned an invalid retry deadline')
      }
      return { allowed: false, retryAfterMs }
    } catch {
      throw new AuthDependencyUnavailableError()
    }
  }
}
