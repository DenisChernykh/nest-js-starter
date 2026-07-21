import {
  metrics,
  type Counter,
  type Histogram,
  type Meter,
} from '@opentelemetry/api'

const methods = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
])

/** Finite HTTP measurement produced by the shared response finalizer. */
export interface HttpMetricRecord {
  readonly method: string
  readonly route: string
  readonly status: number
  readonly durationMs: number
}

/** Low-cardinality OpenTelemetry instruments for final HTTP outcomes. */
export class HttpMetrics {
  private readonly requests: Counter
  private readonly errors: Counter
  private readonly duration: Histogram

  /** Creates no-op instruments until an SDK meter provider is registered. */
  public constructor(meter: Meter = metrics.getMeter('nest-js-starter.http')) {
    this.requests = meter.createCounter('http.server.request.count')
    this.errors = meter.createCounter('http.server.error.count')
    this.duration = meter.createHistogram('http.server.request.duration', {
      unit: 'ms',
    })
  }

  /** Records one validated outcome with method, template and status class only. */
  public record(record: HttpMetricRecord): void {
    if (
      !Number.isFinite(record.durationMs) ||
      record.durationMs < 0 ||
      !Number.isInteger(record.status) ||
      record.status < 100 ||
      record.status > 599 ||
      !validRoute(record.route)
    ) {
      throw new Error('Invalid HTTP metric record')
    }
    const attributes = {
      'http.request.method': methods.has(record.method)
        ? record.method
        : 'OTHER',
      'http.route': record.route,
      'http.response.status_class': `${Math.floor(record.status / 100)}xx`,
    }
    this.requests.add(1, attributes)
    if (record.status >= 500) this.errors.add(1, attributes)
    this.duration.record(record.durationMs, attributes)
  }
}

function validRoute(route: string): boolean {
  return (
    route === 'unmatched' ||
    (route.startsWith('/') &&
      route.length <= 256 &&
      !route.includes('?') &&
      !route.includes('#'))
  )
}
