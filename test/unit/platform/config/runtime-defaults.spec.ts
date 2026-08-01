import { runtimeDefaults } from '@/platform/config/runtime-defaults'

describe('runtimeDefaults', () => {
  it('publishes one immutable internal policy with the reviewed deadlines', () => {
    expect(runtimeDefaults.http).toEqual({
      jsonBodyLimitBytes: 1_048_576,
      requestTimeoutMs: 30_000,
      headersTimeoutMs: 10_000,
      keepAliveTimeoutMs: 5_000,
      drainTimeoutMs: 6_000,
      shutdownGraceMs: 10_000,
    })
    expect(runtimeDefaults.database).toEqual({
      connectionTimeoutMs: 2_000,
      idleTimeoutMs: 300_000,
      healthTimeoutMs: 2_000,
      transactionMaxWaitMs: 5_000,
      transactionTimeoutMs: 10_000,
    })
    expect(runtimeDefaults.redis).toEqual({
      connectTimeoutMs: 2_000,
      commandTimeoutMs: 2_000,
      healthTimeoutMs: 2_500,
      shutdownTimeoutMs: 1_000,
    })
    expect(runtimeDefaults.queue).toEqual({
      connectTimeoutMs: 2_000,
      healthTimeoutMs: 2_500,
      shutdownGraceMs: 10_000,
    })
    expect(runtimeDefaults.auth).toEqual({
      sessionIdleTimeoutMs: 604_800_000,
      sessionAbsoluteTimeoutMs: 2_592_000_000,
      sessionTouchIntervalMs: 300_000,
      loginIpLimit: 20,
      loginAccountLimit: 10,
      loginWindowMs: 900_000,
    })
    expect(runtimeDefaults.observability).toEqual({
      exporterTimeoutMs: 1_000,
      batchSpanScheduleDelayMs: 5_000,
      batchSpanExportTimeoutMs: 1_000,
    })
    expect(Object.isFrozen(runtimeDefaults)).toBe(true)
    expect(Object.isFrozen(runtimeDefaults.http)).toBe(true)
    expect(Object.isFrozen(runtimeDefaults.queue)).toBe(true)
    expect(Object.isFrozen(runtimeDefaults.auth)).toBe(true)
  })
})
