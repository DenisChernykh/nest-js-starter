import type { Meter, Span, Tracer } from '@opentelemetry/api'

import type { AuthTelemetryPort } from '@/modules/auth/application/auth-telemetry.port'
import { OtelAuthTelemetryAdapter } from '@/modules/auth/infrastructure/otel-auth-telemetry.adapter'

describe('OtelAuthTelemetryAdapter', () => {
  it('owns fixed auth span and metric labels inside the auth module', async () => {
    const span = {
      setStatus: jest.fn(),
      end: jest.fn(),
    } as unknown as Span
    const tracer = {
      startActiveSpan: jest.fn(
        (_name: string, work: (active: Span) => unknown) => work(span),
      ),
    } as unknown as Tracer
    const add = jest.fn()
    const meter = {
      createCounter: jest.fn(() => ({ add })),
    } as unknown as Meter
    const adapter = new OtelAuthTelemetryAdapter(tracer, meter)

    await expect(
      adapter.runAuthOperation('login', () => Promise.resolve('ok')),
    ).resolves.toBe('ok')
    adapter.recordAuthOutcome('login', 'success')

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(tracer.startActiveSpan).toHaveBeenCalledWith(
      'auth.login',
      expect.any(Function),
    )
    expect(add).toHaveBeenCalledWith(1, {
      operation: 'login',
      outcome: 'success',
    })
  })

  it('marks failed work without recording the raw error message', async () => {
    const span = {
      setStatus: jest.fn(),
      end: jest.fn(),
    } as unknown as Span
    const tracer = {
      startActiveSpan: jest.fn(
        (_name: string, work: (active: Span) => unknown) => work(span),
      ),
    } as unknown as Tracer
    const meter = createMeter()
    const adapter = new OtelAuthTelemetryAdapter(tracer, meter)

    await expect(
      adapter.runAuthOperation('change_password', () =>
        Promise.reject(new Error('password=raw-secret')),
      ),
    ).rejects.toThrow('password=raw-secret')

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(span.end).toHaveBeenCalledTimes(1)
  })

  it('runs work exactly once when span startup throws', async () => {
    const diagnostic = jest.fn()
    const work = jest.fn(() => Promise.resolve('owned-result'))
    const tracer = {
      startActiveSpan: jest.fn(() => {
        throw new Error('tracer unavailable')
      }),
    } as unknown as Tracer
    const adapter = new OtelAuthTelemetryAdapter(
      tracer,
      createMeter(),
      diagnostic,
    )

    await expect(adapter.runAuthOperation('login', work)).resolves.toBe(
      'owned-result',
    )
    expect(work).toHaveBeenCalledTimes(1)
    expect(diagnostic).toHaveBeenCalledWith('auth_span_start_failed')
  })

  it('isolates metric failures and rejects arbitrary labels', () => {
    const diagnostic = jest.fn()
    const add = jest.fn(() => {
      throw new Error('metric unavailable')
    })
    const adapter = new OtelAuthTelemetryAdapter(
      undefined,
      createMeter(add),
      diagnostic,
    )

    expect(() =>
      adapter.recordAuthOutcome('revoke_session', 'success'),
    ).not.toThrow()
    expect(diagnostic).toHaveBeenCalledWith('auth_metric_emit_failed')
    expect(() =>
      adapter.recordAuthOutcome('user-42' as 'login', 'success'),
    ).toThrow('Invalid auth metric')
  })
})

function compileTimeCardinalityContract(telemetry: AuthTelemetryPort): void {
  // @ts-expect-error Arbitrary operation names cannot produce auth spans.
  void telemetry.runAuthOperation('custom-operation', () =>
    Promise.resolve(undefined),
  )
}

void compileTimeCardinalityContract

function createMeter(add: jest.Mock = jest.fn()): Meter {
  return {
    createCounter: jest.fn(() => ({ add })),
  } as unknown as Meter
}
