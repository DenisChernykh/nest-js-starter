import { metrics, trace } from '@opentelemetry/api'

import { startObservability } from '@/bootstrap/observability/start-observability'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { requiredRuntimeEnvironment } from '@test/support/required-runtime-environment'

void run()

async function run(): Promise<void> {
  const endpoint = process.env['TEST_OTLP_ENDPOINT']
  if (endpoint === undefined) throw new Error('TEST_OTLP_ENDPOINT is required')
  const config = buildApiRuntimeConfig(
    requiredRuntimeEnvironment({
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
      OTEL_SDK_DISABLED: 'false',
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_TIMEOUT: '1000',
      OTEL_METRIC_EXPORT_INTERVAL: '1000',
      OTEL_METRIC_EXPORT_TIMEOUT: '1000',
      OTEL_BSP_SCHEDULE_DELAY: '20',
      OTEL_BSP_EXPORT_TIMEOUT: '1000',
    }),
  )
  const { runtime } = startObservability(config, { write: () => undefined })

  const span = trace.getTracer('otlp-protobuf-fixture').startSpan('wire.trace')
  span.end()
  metrics.getMeter('otlp-protobuf-fixture').createCounter('wire.metric').add(1)

  await new Promise((resolve) => setTimeout(resolve, 80))
  await runtime.close(AbortSignal.timeout(5_000))
}
