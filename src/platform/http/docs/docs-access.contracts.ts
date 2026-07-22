/** Stable public problem codes returned by the documentation access boundary. */
export type DocsAccessProblemCode =
  'AUTHENTICATION_REQUIRED' | 'AUTHORIZATION_DENIED' | 'DEPENDENCY_UNAVAILABLE'

/** Finite authorization result that contains no session credential material. */
export type DocsAccessDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false
      readonly problemCode: DocsAccessProblemCode
    }

/** Platform-facing policy implemented only by the auth composition root. */
export interface DocsAccessPolicy {
  authorize(
    cookieHeader: string | undefined,
    nowMs: number,
  ): Promise<DocsAccessDecision>
}

/** Dependency-injection token for the optional protected documentation policy. */
export const DOCS_ACCESS_POLICY = Symbol('platform:http:docs-access-policy')
