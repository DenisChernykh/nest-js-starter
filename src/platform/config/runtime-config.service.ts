import { Inject, Injectable } from '@nestjs/common'

import {
  APPLICATION_RUNTIME_CONFIG,
  type ApiDocsRuntimeConfig,
  type ApplicationRuntimeConfig,
  type AuthRuntimeConfig,
  type DatabaseRuntimeConfig,
  type HttpRuntimeConfig,
  type LoggingRuntimeConfig,
  type OpenTelemetryRuntimeConfig,
  type RedisRuntimeConfig,
  type RuntimeEnvironment,
  type SafeRuntimeConfigSummary,
} from './runtime-config.types'

/**
 * Sole typed accessor for one prevalidated API runtime configuration.
 *
 * @remarks The composition root supplies a complete immutable value. This
 * service creates defensive copies and never exposes string-key access.
 */
@Injectable()
export class RuntimeConfigService {
  private readonly runtimeEnvironment: RuntimeEnvironment
  private readonly loggingConfig: LoggingRuntimeConfig
  private readonly observabilityConfig: OpenTelemetryRuntimeConfig
  private readonly docsConfig: ApiDocsRuntimeConfig
  private readonly httpConfig: HttpRuntimeConfig
  private readonly databaseConfig: DatabaseRuntimeConfig
  private readonly redisConfig: RedisRuntimeConfig
  private readonly authConfig: AuthRuntimeConfig
  private readonly summary: SafeRuntimeConfigSummary

  public constructor(
    @Inject(APPLICATION_RUNTIME_CONFIG) config: ApplicationRuntimeConfig,
  ) {
    this.runtimeEnvironment = config.environment
    this.loggingConfig = Object.freeze({ ...config.logging })
    this.observabilityConfig = Object.freeze({ ...config.observability })
    this.docsConfig = Object.freeze({ ...config.docs })
    this.httpConfig = Object.freeze({
      ...config.http,
      corsOrigins: Object.freeze([...config.http.corsOrigins]),
      trustedProxyCidrs: Object.freeze([...config.http.trustedProxyCidrs]),
    })
    this.databaseConfig = Object.freeze({ ...config.database })
    this.redisConfig = Object.freeze({ ...config.redis })
    this.authConfig = Object.freeze({
      ...config.auth,
      sessionKeySecret: new Uint8Array(config.auth.sessionKeySecret),
      csrfSecret: new Uint8Array(config.auth.csrfSecret),
      rateLimitKeySecret: new Uint8Array(config.auth.rateLimitKeySecret),
      networkMetadataSecret: new Uint8Array(config.auth.networkMetadataSecret),
      csrfOrigins: Object.freeze([...config.auth.csrfOrigins]),
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
      authCookieName: this.authConfig.sessionCookieName,
    })
  }

  /** Returns the validated deployment mode. */
  public get environment(): RuntimeEnvironment {
    return this.runtimeEnvironment
  }

  /** Returns immutable service identity and logging policy. */
  public get logging(): LoggingRuntimeConfig {
    return this.loggingConfig
  }

  /** Returns immutable OpenTelemetry SDK/export settings. */
  public get observability(): OpenTelemetryRuntimeConfig {
    return this.observabilityConfig
  }

  /** Returns the immutable API documentation exposure policy. */
  public get docs(): ApiDocsRuntimeConfig {
    return this.docsConfig
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
