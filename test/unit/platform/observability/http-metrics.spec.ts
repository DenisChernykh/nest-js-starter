import type { Meter } from '@opentelemetry/api'

import { HttpMetrics } from '@/platform/observability/http-metrics'

describe('HttpMetrics', () => {
  it('records finite method, route template and status-class attributes', () => {
    const fixture = createFixture()

    fixture.metrics.record({
      method: 'CUSTOM-private-id',
      route: '/v1/items/:itemId',
      status: 503,
      durationMs: 12.5,
    })

    const attributes = {
      'http.request.method': 'OTHER',
      'http.route': '/v1/items/:itemId',
      'http.response.status_class': '5xx',
    }
    expect(fixture.requests.add.mock.calls).toEqual([[1, attributes]])
    expect(fixture.errors.add.mock.calls).toEqual([[1, attributes]])
    expect(fixture.duration.record.mock.calls).toEqual([[12.5, attributes]])
  })

  it('does not increment server-error count for a 4xx response', () => {
    const fixture = createFixture()

    fixture.metrics.record({
      method: 'POST',
      route: 'unmatched',
      status: 404,
      durationMs: 1,
    })

    expect(fixture.requests.add).toHaveBeenCalledTimes(1)
    expect(fixture.errors.add).not.toHaveBeenCalled()
    expect(fixture.duration.record).toHaveBeenCalledTimes(1)
  })

  it.each([
    { method: 'GET', route: '/raw?secret=value', status: 200, durationMs: 1 },
    { method: 'GET', route: '/ok', status: 99, durationMs: 1 },
    { method: 'GET', route: '/ok', status: 200, durationMs: -1 },
  ])('rejects unsafe metric record %# before partial emission', (record) => {
    const fixture = createFixture()

    expect(() => fixture.metrics.record(record)).toThrow(
      'Invalid HTTP metric record',
    )
    expect(fixture.requests.add).not.toHaveBeenCalled()
  })
})

function createFixture(): {
  readonly metrics: HttpMetrics
  readonly requests: { readonly add: jest.Mock }
  readonly errors: { readonly add: jest.Mock }
  readonly duration: { readonly record: jest.Mock }
} {
  const requests = { add: jest.fn() }
  const errors = { add: jest.fn() }
  const duration = { record: jest.fn() }
  const meter = {
    createCounter: jest
      .fn()
      .mockReturnValueOnce(requests)
      .mockReturnValueOnce(errors),
    createHistogram: jest.fn(() => duration),
  }
  return {
    metrics: new HttpMetrics(meter as unknown as Meter),
    requests,
    errors,
    duration,
  }
}
