import type { Request } from 'express'

/**
 * Resolves a matched Express route template without reading URL or parameters.
 *
 * @param request - Inbound request after Nest route resolution.
 * @returns A stable route template or the finite `unmatched` fallback.
 */
export function resolveHttpRouteTemplate(request: Request): string {
  const route: unknown = request.route
  const path: unknown =
    route !== null && typeof route === 'object' && 'path' in route
      ? route.path
      : undefined
  if (typeof path !== 'string' || !path.startsWith('/')) return 'unmatched'
  const baseUrl = request.baseUrl
  return baseUrl.length === 0 ? path : `${baseUrl.replace(/\/$/u, '')}${path}`
}
