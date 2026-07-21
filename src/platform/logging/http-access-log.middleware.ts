import { performance } from 'node:perf_hooks'

import type { RequestHandler } from 'express'

import type { CorrelationFieldsProvider } from '@/platform/http/context/correlation-fields.provider'
import type { HttpMetrics } from '@/platform/observability/http-metrics'

import type { StructuredLogger } from './logging.contracts'
import { resolveHttpRouteTemplate } from './http-route-template'

/** Injectable effects owned by the HTTP completion finalizer. */
export interface HttpAccessLogDependencies {
  readonly logger: StructuredLogger
  readonly metrics: Pick<HttpMetrics, 'record'>
  readonly correlation: Pick<CorrelationFieldsProvider, 'getFields'>
  readonly now?: () => number
}

/**
 * Creates one idempotent finish/close finalizer for access logs and metrics.
 *
 * @param dependencies - Logger, metrics, correlation snapshot and monotonic clock.
 * @returns Express middleware that attaches both completion listeners before next.
 */
export function createHttpAccessLogMiddleware(
  dependencies: HttpAccessLogDependencies,
): RequestHandler {
  const now = dependencies.now ?? (() => performance.now())
  return (request, response, next) => {
    const start = now()
    const correlation = dependencies.correlation.getFields()
    let finalized = false

    const finalize = (aborted: boolean): void => {
      if (finalized) return
      finalized = true
      response.off('finish', onFinish)
      response.off('close', onClose)
      const durationMs = now() - start
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new Error('Invalid HTTP access duration')
      }
      const route = resolveHttpRouteTemplate(request)
      const method = normalizeMethod(request.method)
      const status =
        aborted && !response.writableFinished ? 499 : response.statusCode
      const measurement = { route, method, status, durationMs }
      dependencies.logger.write({
        level: status >= 500 ? 'error' : 'info',
        event: 'http_request_completed',
        module: 'HttpAccess',
        correlation,
        attributes: measurement,
      })
      dependencies.metrics.record(measurement)
    }
    const onFinish = (): void => finalize(false)
    const onClose = (): void => finalize(true)
    response.once('finish', onFinish)
    response.once('close', onClose)
    next()
  }
}

function normalizeMethod(method: string): string {
  const normalized = method.toUpperCase()
  return /^[A-Z]{1,16}$/u.test(normalized) ? normalized : 'OTHER'
}
