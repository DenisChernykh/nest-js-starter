import { SpanStatusCode, trace } from '@opentelemetry/api'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis'
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'

import { updateHttpServerSpan } from '@/bootstrap/observability/start-observability'
import { createApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { SanitizingSpanExporter } from '@/platform/observability/sanitizing-span.exporter'

interface CompiledApiRuntime {
  start(): Promise<unknown>
  stop(): Promise<void>
}

interface CompiledApiRuntimeModule {
  ApiRuntime: new (factory: () => Promise<object>) => CompiledApiRuntime
}

interface CompiledConfigureApiModule {
  configureApi: (
    config: ReturnType<typeof createApiRuntimeConfig>,
  ) => Promise<object>
}

const COMPILED_API_RUNTIME_PATH =
  '../../../../../dist/bootstrap/api/api-runtime.js'
const COMPILED_CONFIGURE_API_PATH =
  '../../../../../dist/bootstrap/api/configure-api.js'

const spanExporter = new InMemorySpanExporter()
const metricExporter = new InMemoryMetricExporter(
  AggregationTemporality.CUMULATIVE,
)
const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 60_000,
  exportTimeoutMillis: 1_000,
})
const sdk = new NodeSDK({
  spanProcessors: [
    new SimpleSpanProcessor(new SanitizingSpanExporter(spanExporter)),
  ],
  metricReaders: [metricReader],
  instrumentations: [
    new HttpInstrumentation({
      applyCustomAttributesOnSpan: updateHttpServerSpan,
    }),
    new PgInstrumentation({ enhancedDatabaseReporting: false }),
    new RedisInstrumentation({
      dbStatementSerializer: (commandName) => commandName.toUpperCase(),
    }),
  ],
})

void start()

async function start(): Promise<void> {
  sdk.start()
  const apiRuntimeModule = (await import(
    COMPILED_API_RUNTIME_PATH
  )) as unknown as CompiledApiRuntimeModule
  const configureApiModule = (await import(
    COMPILED_CONFIGURE_API_PATH
  )) as unknown as CompiledConfigureApiModule
  const { ApiRuntime } = apiRuntimeModule
  const { configureApi } = configureApiModule
  const config = createApiRuntimeConfig()
  const runtime = new ApiRuntime(() => configureApi(config))
  await runtime.start()
  process.send?.({ type: 'ready' })

  process.once('message', (message: unknown) => {
    if (!isSnapshotMessage(message)) return
    void snapshotAndStop(runtime)
  })
}

async function snapshotAndStop(runtime: {
  stop(): Promise<void>
}): Promise<void> {
  try {
    const privacySpan = trace
      .getTracer('nest-js-starter.privacy-fixture')
      .startSpan('privacy.failure')
    privacySpan.setAttribute('url.full', 'https://private/?token=span-secret')
    privacySpan.setAttribute('db.statement', 'SELECT span-secret')
    privacySpan.recordException(new Error('password=span-secret'))
    privacySpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'password=span-secret',
    })
    privacySpan.end()
    await metricReader.forceFlush()
    process.send?.({
      type: 'snapshot',
      spans: spanExporter.getFinishedSpans().map((span) => ({
        name: span.name,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanContext?.spanId,
        attributes: span.attributes,
        events: span.events,
        links: span.links,
        status: span.status,
      })),
      metrics: metricExporter.getMetrics().flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) =>
          scope.metrics.flatMap((metric) =>
            metric.dataPoints.map((point) => ({
              scope: scope.scope.name,
              name: metric.descriptor.name,
              attributes: point.attributes,
              value: point.value,
            })),
          ),
        ),
      ),
    })
  } finally {
    await runtime.stop()
    await sdk.shutdown()
  }
}

function isSnapshotMessage(value: unknown): value is { type: 'snapshot' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'snapshot'
  )
}
