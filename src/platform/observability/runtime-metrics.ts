import {
  metrics,
  type Counter,
  type Histogram,
  type Meter,
} from '@opentelemetry/api'

/** External runtime dependencies allowed in metric attributes. */
export type RuntimeDependency = 'postgres' | 'redis'

/** Finite dependency outcomes allowed in metric attributes. */
export type DependencyOutcome = 'success' | 'error'

/** Finite cache events allowed in metric attributes. */
export type CacheMetricEvent =
  'hit' | 'miss' | 'invalid' | 'error' | 'write' | 'invalidate'

type TelemetryDiagnostic = (code: string) => void

const dependencies = new Set<RuntimeDependency>(['postgres', 'redis'])
const dependencyOutcomes = new Set<DependencyOutcome>(['success', 'error'])
const cacheEvents = new Set<CacheMetricEvent>([
  'hit',
  'miss',
  'invalid',
  'error',
  'write',
  'invalidate',
])

/** Low-cardinality OpenTelemetry instruments for critical runtime operations. */
export class RuntimeMetrics {
  private readonly dependencyDuration: Histogram
  private readonly dependencyErrors: Counter
  private readonly redisReconnects: Counter
  private readonly cacheOperations: Counter

  /** Creates instruments backed by the active global meter provider. */
  public constructor(
    meter: Meter = metrics.getMeter('nest-js-starter.runtime'),
    private readonly diagnostic: TelemetryDiagnostic = () => undefined,
  ) {
    this.dependencyDuration = meter.createHistogram(
      'dependency.operation.duration',
      { unit: 'ms' },
    )
    this.dependencyErrors = meter.createCounter(
      'dependency.operation.error.count',
    )
    this.redisReconnects = meter.createCounter('redis.reconnect.count')
    this.cacheOperations = meter.createCounter('cache.operation.count')
  }

  /** Records one monotonic dependency duration and its finite outcome. */
  public recordDependency(
    dependency: RuntimeDependency,
    outcome: DependencyOutcome,
    durationMs: number,
  ): void {
    if (
      !dependencies.has(dependency) ||
      !dependencyOutcomes.has(outcome) ||
      !Number.isFinite(durationMs) ||
      durationMs < 0
    ) {
      throw new Error('Invalid runtime metric')
    }
    const attributes = { dependency, outcome }
    this.emit(() => {
      this.dependencyDuration.record(durationMs, attributes)
      if (outcome === 'error') this.dependencyErrors.add(1, attributes)
    })
  }

  /** Counts one Redis connection attempt without endpoint attributes. */
  public recordRedisReconnect(outcome: DependencyOutcome): void {
    if (!dependencyOutcomes.has(outcome)) {
      throw new Error('Invalid runtime metric')
    }
    this.emit(() =>
      this.redisReconnects.add(1, { dependency: 'redis', outcome }),
    )
  }

  /** Counts one finite cache result without recording its key. */
  public recordCache(event: CacheMetricEvent): void {
    if (!cacheEvents.has(event)) throw new Error('Invalid runtime metric')
    this.emit(() => this.cacheOperations.add(1, { event }))
  }

  private emit(work: () => void): void {
    try {
      work()
    } catch {
      try {
        this.diagnostic('runtime_metric_emit_failed')
      } catch {
        // Diagnostic output cannot recurse into or affect runtime behavior.
      }
    }
  }
}
