import type { RequestHandler } from 'express'

import type { RequestContext } from '../context/request-context'
import type { ProblemDocument } from '../errors/problem.contracts'
import { PROBLEM_REGISTRY } from '../errors/problem-registry'
import type {
  DocsAccessDecision,
  DocsAccessPolicy,
} from './docs-access.contracts'

/**
 * Identifies only the Swagger UI subtree and exact canonical JSON route.
 *
 * @param path - Express request path without its query string.
 * @returns Whether the protected documentation policy owns the path.
 */
export function isDocsAccessPath(path: string): boolean {
  return (
    path === '/docs' || path.startsWith('/docs/') || path === '/openapi.json'
  )
}

function writeDenial(
  decision: Exclude<DocsAccessDecision, { readonly allowed: true }>,
  requestContext: RequestContext,
  response: Parameters<RequestHandler>[1],
): void {
  const definition = PROBLEM_REGISTRY.get(decision.problemCode)
  const requestId = requestContext.getRequestId()
  if (requestId === undefined) {
    throw new Error('Docs access middleware requires an active request context')
  }
  const document: ProblemDocument = {
    type: definition.type,
    title: definition.title,
    status: definition.status,
    detail: definition.detail,
    instance: `urn:request:${requestId}`,
    code: definition.code,
    requestId,
  }
  response
    .status(definition.status)
    .type('application/problem+json')
    .json(document)
}

/**
 * Creates the policy-only boundary mounted before protected docs routes.
 *
 * @param policy - Finite auth decision policy with no transport dependency.
 * @param requestContext - Correlation state established by the first middleware.
 * @param now - Clock used for fresh session authentication.
 * @returns Express middleware that either continues or writes RFC 9457.
 */
export function createDocsAccessMiddleware(
  policy: DocsAccessPolicy,
  requestContext: RequestContext,
  now: () => number = Date.now,
): RequestHandler {
  return async (request, response, next): Promise<void> => {
    if (!isDocsAccessPath(request.path)) {
      next()
      return
    }
    const decision = await policy.authorize(request.headers.cookie, now())
    if (decision.allowed) {
      next()
      return
    }
    writeDenial(decision, requestContext, response)
  }
}
