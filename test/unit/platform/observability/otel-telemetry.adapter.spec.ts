import type { Span, Tracer } from '@opentelemetry/api'

import { OtelTelemetryAdapter } from '@/platform/observability/otel-telemetry.adapter'
import type { RuntimeMetrics } from '@/platform/observability/runtime-metrics'

describe('OtelTelemetryAdapter', () => {
  it('uses a fixed span name and never records a raw failure message', async () => {
    const span = {
      setStatus: jest.fn(),
      end: jest.fn(),
    } as unknown as Span
    const tracer = {
      startActiveSpan: jest.fn(
        (_name: string, work: (active: Span) => unknown) => work(span),
      ),
    } as unknown as Tracer
    const adapter = new OtelTelemetryAdapter(tracer)

    await expect(
      adapter.runAuthOperation('change_password', () =>
        Promise.reject(new Error('password=raw-secret')),
      ),
    ).rejects.toThrow('password=raw-secret')

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(tracer.startActiveSpan).toHaveBeenCalledWith(
      'auth.change_password',
      expect.any(Function),
    )
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 })
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(span.end).toHaveBeenCalledTimes(1)
  })

  it('runs the underlying operation exactly once when span startup throws', async () => {
    const diagnostic = jest.fn()
    const work = jest.fn(() => Promise.resolve('owned-result'))
    const tracer = {
      startActiveSpan: jest.fn(() => {
        throw new Error('tracer unavailable')
      }),
    } as unknown as Tracer
    const adapter = new OtelTelemetryAdapter(tracer, undefined, diagnostic)

    await expect(adapter.runAuthOperation('login', work)).resolves.toBe(
      'owned-result',
    )
    expect(work).toHaveBeenCalledTimes(1)
    expect(diagnostic).toHaveBeenCalledWith('auth_span_start_failed')
  })

  it('isolates metric adapter failures from its caller', () => {
    const diagnostic = jest.fn()
    const metrics = {
      recordAuth: jest.fn(() => {
        throw new Error('metric unavailable')
      }),
    } as unknown as RuntimeMetrics
    const adapter = new OtelTelemetryAdapter(undefined, metrics, diagnostic)

    expect(() =>
      adapter.recordAuthOutcome('revoke_session', 'success'),
    ).not.toThrow()
    expect(diagnostic).toHaveBeenCalledWith('auth_metric_emit_failed')
  })
})
