import { diag, DiagLogLevel, type Span } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { Request } from 'express'

import type { ApplicationRuntimeConfig } from '@/platform/config/runtime-config.types'
import type { StructuredLogger } from '@/platform/logging/logging.contracts'
import { resolveHttpRouteTemplate } from '@/platform/logging/http-route-template'
import { ObservabilityRuntime } from '@/platform/observability/observability.runtime'
import { OtelDiagLogger } from '@/platform/observability/otel-diag.logger'
import { SanitizingSpanExporter } from '@/platform/observability/sanitizing-span.exporter'

import type { ObservabilityBootstrapResult } from './observability-bootstrap.types'

/** Starts configured telemetry before any instrumented application import. */
export function startObservability(
  config: ApplicationRuntimeConfig,
  logger: StructuredLogger,
): ObservabilityBootstrapResult {
  if (config.observability.disabled) {
    return { runtime: new ObservabilityRuntime(), enabled: false }
  }
  diag.setLogger(new OtelDiagLogger(logger), DiagLogLevel.WARN)
  const traceExporter = new SanitizingSpanExporter(
    new OTLPTraceExporter({
      ...traceEndpoint(config),
      timeoutMillis: config.observability.exporterTimeoutMs,
    }),
  )
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': config.logging.serviceName,
      'service.version': config.logging.serviceVersion,
      'service.revision': config.logging.serviceRevision,
      'deployment.environment.name': config.environment,
    }),
    spanProcessors: [
      new BatchSpanProcessor(traceExporter, {
        scheduledDelayMillis: config.observability.batchSpanScheduleDelayMs,
        exportTimeoutMillis: config.observability.batchSpanExportTimeoutMs,
      }),
    ],
  })
  provider.register()
  const unregisterInstrumentations = registerInstrumentations({
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
  return {
    runtime: new ObservabilityRuntime({
      shutdown: async () => {
        unregisterInstrumentations()
        await provider.shutdown()
      },
    }),
    enabled: true,
  }
}

/** Applies the same bounded route template to an ending HTTP server span. */
export function updateHttpServerSpan(
  span: Span,
  request: ClientRequest | IncomingMessage,
): void {
  if (!('route' in request)) return
  const route = resolveHttpRouteTemplate(request as unknown as Request)
  span.setAttribute('http.route', route)
  span.updateName(`${request.method ?? 'HTTP'} ${route}`)
}

function traceEndpoint(config: ApplicationRuntimeConfig): {
  readonly url?: string
} {
  if (config.observability.endpoint === undefined) return {}
  const base = config.observability.endpoint.endsWith('/')
    ? config.observability.endpoint
    : `${config.observability.endpoint}/`
  return { url: new URL('v1/traces', base).toString() }
}
