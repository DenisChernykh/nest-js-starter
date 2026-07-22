import type { Meter } from '@opentelemetry/api'

import { RuntimeMetrics } from '@/platform/observability/runtime-metrics'

describe('RuntimeMetrics', () => {
  it('emits only the exact finite dependency and cache attributes', () => {
    const fixture = createFixture()

    fixture.metrics.recordDependency('postgres', 'success', 12.5)
    fixture.metrics.recordDependency('redis', 'error', 4)
    fixture.metrics.recordRedisReconnect('success')
    fixture.metrics.recordCache('hit')

    expect(
      fixture.histograms.get('dependency.operation.duration')?.record,
    ).toHaveBeenNthCalledWith(1, 12.5, {
      dependency: 'postgres',
      outcome: 'success',
    })
    expect(
      fixture.histograms.get('dependency.operation.duration')?.record,
    ).toHaveBeenNthCalledWith(2, 4, {
      dependency: 'redis',
      outcome: 'error',
    })
    expect(
      fixture.counters.get('dependency.operation.error.count')?.add,
    ).toHaveBeenCalledWith(1, { dependency: 'redis', outcome: 'error' })
    expect(
      fixture.counters.get('redis.reconnect.count')?.add,
    ).toHaveBeenCalledWith(1, { dependency: 'redis', outcome: 'success' })
    expect(
      fixture.counters.get('cache.operation.count')?.add,
    ).toHaveBeenCalledWith(1, { event: 'hit' })
  })

  it('rejects arbitrary cardinality before emitting a point', () => {
    const fixture = createFixture()

    expect(() =>
      fixture.metrics.recordCache('starter:v1:item:42' as 'hit'),
    ).toThrow('Invalid runtime metric')
    expect(() =>
      fixture.metrics.recordDependency(
        'route-/users/42' as 'postgres',
        'error',
        1,
      ),
    ).toThrow('Invalid runtime metric')
    expect(
      fixture.counters.get('cache.operation.count')?.add,
    ).not.toHaveBeenCalled()
    expect(
      fixture.histograms.get('dependency.operation.duration')?.record,
    ).not.toHaveBeenCalled()
  })

  it('isolates instrument and diagnostic failures', () => {
    const diagnostic = jest.fn(() => {
      throw new Error('diagnostic unavailable')
    })
    const fixture = createFixture(diagnostic)
    fixture.counters
      .get('cache.operation.count')
      ?.add.mockImplementation(() => {
        throw new Error('export path unavailable')
      })

    expect(() => fixture.metrics.recordCache('hit')).not.toThrow()
    expect(diagnostic).toHaveBeenCalledWith('runtime_metric_emit_failed')
  })
})

function compileTimeCardinalityContract(metrics: RuntimeMetrics): void {
  // @ts-expect-error Cache keys are not cache event labels.
  metrics.recordCache('starter:v1:item:42')
  // @ts-expect-error HTTP routes are not dependency labels.
  metrics.recordDependency('/users/:userId', 'error', 1)
}

void compileTimeCardinalityContract

function createFixture(diagnostic: (code: string) => void = jest.fn()): {
  readonly metrics: RuntimeMetrics
  readonly counters: Map<string, { readonly add: jest.Mock }>
  readonly histograms: Map<string, { readonly record: jest.Mock }>
} {
  const counters = new Map<string, { readonly add: jest.Mock }>()
  const histograms = new Map<string, { readonly record: jest.Mock }>()
  const meter = {
    createCounter: jest.fn((name: string) => {
      const counter = { add: jest.fn() }
      counters.set(name, counter)
      return counter
    }),
    createHistogram: jest.fn((name: string) => {
      const histogram = { record: jest.fn() }
      histograms.set(name, histogram)
      return histogram
    }),
  }
  return {
    metrics: new RuntimeMetrics(meter as unknown as Meter, diagnostic),
    counters,
    histograms,
  }
}
