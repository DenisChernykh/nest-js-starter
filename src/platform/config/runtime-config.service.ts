import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type {
  AuthRuntimeConfig,
  DatabaseRuntimeConfig,
  HttpRuntimeConfig,
  RedisRuntimeConfig,
  RuntimeEnvironment,
  SafeRuntimeConfigSummary,
  ValidatedRuntimeEnvironment,
} from './runtime-config.types'

/**
 * Sole typed accessor for validated runtime configuration.
 *
 * @remarks Grouped values are constructed and frozen once. Consumers never
 * receive the underlying Nest string-key accessor or mutable URL objects.
 */
@Injectable()
export class RuntimeConfigService {
  private readonly runtimeEnvironment: RuntimeEnvironment
  private readonly httpConfig: HttpRuntimeConfig
  private readonly databaseConfig: DatabaseRuntimeConfig
  private readonly redisConfig: RedisRuntimeConfig
  private readonly authConfig: AuthRuntimeConfig
  private readonly summary: SafeRuntimeConfigSummary

  public constructor(config: ConfigService<ValidatedRuntimeEnvironment, true>) {
    this.runtimeEnvironment = config.getOrThrow('NODE_ENV', { infer: true })
    this.httpConfig = Object.freeze({
      host: config.getOrThrow('API_HOST', { infer: true }),
      port: config.getOrThrow('API_PORT', { infer: true }),
      publicApiUrl: config.getOrThrow('PUBLIC_API_URL', { infer: true }),
      corsOrigins: Object.freeze([
        ...config.getOrThrow('CORS_ORIGINS', { infer: true }),
      ]),
      trustedProxyCidrs: Object.freeze([
        ...config.getOrThrow('TRUST_PROXY_CIDRS', { infer: true }),
      ]),
      jsonBodyLimitBytes: config.getOrThrow('HTTP_JSON_BODY_LIMIT_BYTES', {
        infer: true,
      }),
      requestTimeoutMs: config.getOrThrow('HTTP_REQUEST_TIMEOUT_MS', {
        infer: true,
      }),
      headersTimeoutMs: config.getOrThrow('HTTP_HEADERS_TIMEOUT_MS', {
        infer: true,
      }),
      keepAliveTimeoutMs: config.getOrThrow('HTTP_KEEP_ALIVE_TIMEOUT_MS', {
        infer: true,
      }),
      drainTimeoutMs: config.getOrThrow('HTTP_DRAIN_TIMEOUT_MS', {
        infer: true,
      }),
      shutdownGraceMs: config.getOrThrow('SHUTDOWN_GRACE_MS', {
        infer: true,
      }),
    })
    this.databaseConfig = Object.freeze({
      url: config.getOrThrow('DATABASE_URL', { infer: true }),
      poolMax: config.getOrThrow('DATABASE_POOL_MAX', { infer: true }),
      connectionTimeoutMs: config.getOrThrow('DATABASE_CONNECTION_TIMEOUT_MS', {
        infer: true,
      }),
      idleTimeoutMs: config.getOrThrow('DATABASE_IDLE_TIMEOUT_MS', {
        infer: true,
      }),
      healthTimeoutMs: config.getOrThrow('DATABASE_HEALTH_TIMEOUT_MS', {
        infer: true,
      }),
      transactionMaxWaitMs: config.getOrThrow(
        'DATABASE_TRANSACTION_MAX_WAIT_MS',
        { infer: true },
      ),
      transactionTimeoutMs: config.getOrThrow(
        'DATABASE_TRANSACTION_TIMEOUT_MS',
        { infer: true },
      ),
    })
    const cacheUrl = config.get('REDIS_CACHE_URL', { infer: true })
    this.redisConfig = Object.freeze({
      coordinationUrl: config.getOrThrow('REDIS_COORDINATION_URL', {
        infer: true,
      }),
      ...(cacheUrl === undefined ? {} : { cacheUrl }),
      connectTimeoutMs: config.getOrThrow('REDIS_CONNECT_TIMEOUT_MS', {
        infer: true,
      }),
      commandTimeoutMs: config.getOrThrow('REDIS_COMMAND_TIMEOUT_MS', {
        infer: true,
      }),
      healthTimeoutMs: config.getOrThrow('REDIS_HEALTH_TIMEOUT_MS', {
        infer: true,
      }),
      shutdownTimeoutMs: config.getOrThrow('REDIS_SHUTDOWN_TIMEOUT_MS', {
        infer: true,
      }),
      keyPrefix: config.getOrThrow('REDIS_KEY_PREFIX', { infer: true }),
    })
    this.authConfig = Object.freeze({
      sessionCookieName: config.getOrThrow('AUTH_SESSION_COOKIE_NAME', {
        infer: true,
      }),
      secureCookie: config.getOrThrow('AUTH_COOKIE_SECURE', { infer: true }),
      sessionIdleTimeoutMs: config.getOrThrow('AUTH_SESSION_IDLE_TIMEOUT_MS', {
        infer: true,
      }),
      sessionAbsoluteTimeoutMs: config.getOrThrow(
        'AUTH_SESSION_ABSOLUTE_TIMEOUT_MS',
        { infer: true },
      ),
      sessionTouchIntervalMs: config.getOrThrow(
        'AUTH_SESSION_TOUCH_INTERVAL_MS',
        { infer: true },
      ),
      sessionKeySecret: new Uint8Array(
        config.getOrThrow('AUTH_SESSION_KEY_SECRET', { infer: true }),
      ),
      csrfSecret: new Uint8Array(
        config.getOrThrow('AUTH_CSRF_SECRET', { infer: true }),
      ),
      rateLimitKeySecret: new Uint8Array(
        config.getOrThrow('AUTH_RATE_LIMIT_KEY_SECRET', { infer: true }),
      ),
      networkMetadataSecret: new Uint8Array(
        config.getOrThrow('AUTH_NETWORK_METADATA_SECRET', { infer: true }),
      ),
      csrfOrigins: Object.freeze([
        ...config.getOrThrow('AUTH_CSRF_ORIGINS', { infer: true }),
      ]),
      loginIpLimit: config.getOrThrow('AUTH_LOGIN_IP_LIMIT', { infer: true }),
      loginAccountLimit: config.getOrThrow('AUTH_LOGIN_ACCOUNT_LIMIT', {
        infer: true,
      }),
      loginWindowMs: config.getOrThrow('AUTH_LOGIN_WINDOW_MS', { infer: true }),
    })
    this.summary = Object.freeze({
      environment: this.runtimeEnvironment,
      apiHost: this.httpConfig.host,
      apiPort: this.httpConfig.port,
      publicApiOrigin: this.httpConfig.publicApiUrl,
      corsOriginCount: this.httpConfig.corsOrigins.length,
      trustedProxyCount: this.httpConfig.trustedProxyCidrs.length,
      databasePoolMax: this.databaseConfig.poolMax,
      redisCoordinationConfigured: true,
      redisCacheConfigured: this.redisConfig.cacheUrl !== undefined,
      authCookieName: this.authConfig.sessionCookieName,
    })
  }

  /** Returns the validated deployment mode. */
  public get environment(): RuntimeEnvironment {
    return this.runtimeEnvironment
  }

  /** Returns immutable HTTP settings. */
  public get http(): HttpRuntimeConfig {
    return this.httpConfig
  }

  /** Returns immutable PostgreSQL settings, including its secret URL. */
  public get database(): DatabaseRuntimeConfig {
    return this.databaseConfig
  }

  /** Returns immutable Redis settings, including secret-bearing URLs. */
  public get redis(): RedisRuntimeConfig {
    return this.redisConfig
  }

  /** Returns immutable auth policy with defensive secret byte copies. */
  public get auth(): AuthRuntimeConfig {
    return Object.freeze({
      ...this.authConfig,
      sessionKeySecret: new Uint8Array(this.authConfig.sessionKeySecret),
      csrfSecret: new Uint8Array(this.authConfig.csrfSecret),
      rateLimitKeySecret: new Uint8Array(this.authConfig.rateLimitKeySecret),
      networkMetadataSecret: new Uint8Array(
        this.authConfig.networkMetadataSecret,
      ),
    })
  }

  /** Returns the immutable non-secret startup projection. */
  public get safeSummary(): SafeRuntimeConfigSummary {
    return this.summary
  }
}
