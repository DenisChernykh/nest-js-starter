import type { RequestHandler } from 'express'

import { REQUEST_ID_HEADER, resolveRequestId } from './request-id'
import type { RequestContext } from './request-context'

/**
 * Creates the first HTTP middleware that resolves and propagates request ID.
 *
 * @param context - Process-wide ALS request context.
 * @param generateRequestId - Optional deterministic UUID generator for tests.
 * @returns Express middleware that binds the response header before downstream work.
 */
export function createRequestContextMiddleware(
  context: RequestContext,
  generateRequestId?: () => string,
): RequestHandler {
  return (request, response, next) => {
    const resolved = resolveRequestId(
      request.headers['x-request-id'],
      generateRequestId,
    )
    context.run(resolved.requestId, () => {
      response.setHeader(REQUEST_ID_HEADER, resolved.requestId)
      next()
    })
  }
}
