import type { NextFunction, Request, RequestHandler, Response } from 'express'

import type { ApplicationLifecycleState } from '@/platform/lifecycle/application-lifecycle.state'

/** Creates a middleware that admits application traffic only while ready. */
export function createTrafficGateMiddleware(
  lifecycle: ApplicationLifecycleState,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.path.startsWith('/health/')) {
      next()
      return
    }
    if (lifecycle.phase === 'ready') {
      next()
      return
    }
    response.status(503).json({ status: 'unavailable' })
  }
}
