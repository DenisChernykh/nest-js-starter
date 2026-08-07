/** Fixed HTTP limits and bounded transport shutdown deadlines. */
export interface HttpRuntimeDefaults {
  readonly jsonBodyLimitBytes: number
  readonly requestTimeoutMs: number
  readonly headersTimeoutMs: number
  readonly keepAliveTimeoutMs: number
  readonly drainTimeoutMs: number
  readonly shutdownGraceMs: number
}

/** Fixed PostgreSQL pool, health and transaction deadlines. */
export interface DatabaseRuntimeDefaults {
  readonly connectionTimeoutMs: number
  readonly idleTimeoutMs: number
  readonly healthTimeoutMs: number
  readonly transactionMaxWaitMs: number
  readonly transactionTimeoutMs: number
}

/** Fixed auth Redis connection and command deadlines. */
export interface RedisRuntimeDefaults {
  readonly connectTimeoutMs: number
  readonly commandTimeoutMs: number
  readonly healthTimeoutMs: number
  readonly shutdownTimeoutMs: number
}

/** Fixed optional BullMQ queue connection and worker deadlines. */
export interface QueueRuntimeDefaults {
  readonly connectTimeoutMs: number
  readonly healthTimeoutMs: number
  readonly shutdownGraceMs: number
}

/** Fixed browser-session and distributed-login policy. */
export interface AuthRuntimeDefaults {
  readonly sessionIdleTimeoutMs: number
  readonly sessionAbsoluteTimeoutMs: number
  readonly sessionTouchIntervalMs: number
  readonly loginIpLimit: number
  readonly loginAccountLimit: number
  readonly loginWindowMs: number
  readonly selfService: {
    readonly verificationTtlMs: number
    readonly passwordResetTtlMs: number
    readonly acceptedResponseFloorMs: number
    readonly mailDeliveryTimeoutMs: number
    readonly registrationIpLimit: number
    readonly registrationAccountLimit: number
    readonly resendIpLimit: number
    readonly resendAccountLimit: number
    readonly resetRequestIpLimit: number
    readonly resetRequestAccountLimit: number
    readonly requestWindowMs: number
    readonly resendCooldownMs: number
  }
  readonly accountEmailWorkflows: {
    readonly invitationTtlMs: number
  }
}

/** Fixed OpenTelemetry trace exporter and batch processor deadlines. */
export interface ObservabilityRuntimeDefaults {
  readonly exporterTimeoutMs: number
  readonly batchSpanScheduleDelayMs: number
  readonly batchSpanExportTimeoutMs: number
}

/**
 * Immutable internal runtime policy that is intentionally not environment
 * configurable.
 */
export interface RuntimeDefaults {
  readonly http: HttpRuntimeDefaults
  readonly database: DatabaseRuntimeDefaults
  readonly redis: RedisRuntimeDefaults
  readonly queue: QueueRuntimeDefaults
  readonly auth: AuthRuntimeDefaults
  readonly observability: ObservabilityRuntimeDefaults
}

/** One reviewed, typed source for all internal runtime defaults. */
export const runtimeDefaults: RuntimeDefaults = Object.freeze({
  http: Object.freeze({
    jsonBodyLimitBytes: 1_048_576,
    requestTimeoutMs: 30_000,
    headersTimeoutMs: 10_000,
    keepAliveTimeoutMs: 5_000,
    drainTimeoutMs: 6_000,
    shutdownGraceMs: 10_000,
  }),
  database: Object.freeze({
    connectionTimeoutMs: 2_000,
    idleTimeoutMs: 300_000,
    healthTimeoutMs: 2_000,
    transactionMaxWaitMs: 5_000,
    transactionTimeoutMs: 10_000,
  }),
  redis: Object.freeze({
    connectTimeoutMs: 2_000,
    commandTimeoutMs: 2_000,
    healthTimeoutMs: 2_500,
    shutdownTimeoutMs: 1_000,
  }),
  queue: Object.freeze({
    connectTimeoutMs: 2_000,
    healthTimeoutMs: 2_500,
    shutdownGraceMs: 10_000,
  }),
  auth: Object.freeze({
    sessionIdleTimeoutMs: 604_800_000,
    sessionAbsoluteTimeoutMs: 2_592_000_000,
    sessionTouchIntervalMs: 300_000,
    loginIpLimit: 20,
    loginAccountLimit: 10,
    loginWindowMs: 900_000,
    selfService: Object.freeze({
      verificationTtlMs: 86_400_000,
      passwordResetTtlMs: 1_800_000,
      acceptedResponseFloorMs: 2_000,
      mailDeliveryTimeoutMs: 1_500,
      registrationIpLimit: 10,
      registrationAccountLimit: 3,
      resendIpLimit: 10,
      resendAccountLimit: 3,
      resetRequestIpLimit: 10,
      resetRequestAccountLimit: 3,
      requestWindowMs: 3_600_000,
      resendCooldownMs: 60_000,
    }),
    accountEmailWorkflows: Object.freeze({
      invitationTtlMs: 86_400_000,
    }),
  }),
  observability: Object.freeze({
    exporterTimeoutMs: 1_000,
    batchSpanScheduleDelayMs: 5_000,
    batchSpanExportTimeoutMs: 1_000,
  }),
})
