import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type {
  DatabaseRuntimeConfig,
  HttpRuntimeConfig,
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
    this.summary = Object.freeze({
      environment: this.runtimeEnvironment,
      apiHost: this.httpConfig.host,
      apiPort: this.httpConfig.port,
      publicApiOrigin: this.httpConfig.publicApiUrl,
      corsOriginCount: this.httpConfig.corsOrigins.length,
      trustedProxyCount: this.httpConfig.trustedProxyCidrs.length,
      databasePoolMax: this.databaseConfig.poolMax,
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

  /** Returns the immutable non-secret startup projection. */
  public get safeSummary(): SafeRuntimeConfigSummary {
    return this.summary
  }
}
