import { diag, DiagLogLevel, type Span } from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
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
      ...endpointOption(config, 'traces'),
      timeoutMillis: config.observability.exporterTimeoutMs,
    }),
  )
  const metricExporter = new OTLPMetricExporter({
    ...endpointOption(config, 'metrics'),
    timeoutMillis: config.observability.exporterTimeoutMs,
  })
  const sdk = new NodeSDK({
    autoDetectResources: false,
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
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: config.observability.metricExportIntervalMs,
        exportTimeoutMillis: config.observability.metricExportTimeoutMs,
      }),
    ],
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
  sdk.start()
  return { runtime: new ObservabilityRuntime(sdk), enabled: true }
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

function endpointOption(
  config: ApplicationRuntimeConfig,
  signal: 'traces' | 'metrics',
): { readonly url?: string } {
  const specific =
    signal === 'traces'
      ? config.observability.tracesEndpoint
      : config.observability.metricsEndpoint
  if (specific !== undefined) return { url: specific }
  if (config.observability.endpoint === undefined) return {}
  const base = config.observability.endpoint.endsWith('/')
    ? config.observability.endpoint
    : `${config.observability.endpoint}/`
  return { url: new URL(`v1/${signal}`, base).toString() }
}
