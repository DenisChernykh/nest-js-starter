import type {
  ProblemDefinition,
  RegisteredProblemDefinition,
} from './problem.contracts'

const PROBLEM_BASE_URI = 'https://nest-js-starter.invalid/problems'

const problemDefinitions = [
  {
    slug: 'malformed-request',
    code: 'MALFORMED_REQUEST',
    status: 400,
    title: 'Malformed request',
    detail: 'The request could not be parsed.',
  },
  {
    slug: 'authentication-required',
    code: 'AUTHENTICATION_REQUIRED',
    status: 401,
    title: 'Authentication required',
    detail: 'Valid authentication is required for this request.',
  },
  {
    slug: 'authorization-denied',
    code: 'AUTHORIZATION_DENIED',
    status: 403,
    title: 'Authorization denied',
    detail: 'The authenticated principal cannot perform this request.',
  },
  {
    slug: 'not-found',
    code: 'NOT_FOUND',
    status: 404,
    title: 'Resource not found',
    detail: 'The requested resource does not exist.',
  },
  {
    slug: 'conflict',
    code: 'CONFLICT',
    status: 409,
    title: 'Request conflict',
    detail: 'The request conflicts with the current resource state.',
  },
  {
    slug: 'payload-too-large',
    code: 'PAYLOAD_TOO_LARGE',
    status: 413,
    title: 'Payload too large',
    detail: 'The request payload exceeds the configured limit.',
  },
  {
    slug: 'unsupported-media-type',
    code: 'UNSUPPORTED_MEDIA_TYPE',
    status: 415,
    title: 'Unsupported media type',
    detail: 'The request content type is not supported.',
  },
  {
    slug: 'validation-failed',
    code: 'VALIDATION_FAILED',
    status: 422,
    title: 'Validation failed',
    detail: 'One or more request fields are invalid.',
  },
  {
    slug: 'rate-limit-exceeded',
    code: 'RATE_LIMIT_EXCEEDED',
    status: 429,
    title: 'Rate limit exceeded',
    detail: 'Too many requests were submitted in the allowed interval.',
  },
  {
    slug: 'internal-error',
    code: 'INTERNAL_ERROR',
    status: 500,
    title: 'Internal server error',
    detail: 'The server could not complete the request.',
  },
  {
    slug: 'dependency-unavailable',
    code: 'DEPENDENCY_UNAVAILABLE',
    status: 503,
    title: 'Dependency unavailable',
    detail: 'A required service is temporarily unavailable.',
  },
] as const satisfies readonly ProblemDefinition[]

/** Stable machine codes owned by the starter core problem catalogue. */
export type CoreProblemCode = (typeof problemDefinitions)[number]['code']

/** Compatibility alias for transport decorators restricted to core codes. */
export type ProblemCode = CoreProblemCode

/**
 * Commits a starter-owned problem slug to the shared absolute type namespace.
 *
 * @param definition - Stable public problem metadata without a derived type.
 * @returns One frozen registered definition with its absolute type URI.
 */
export function defineProblemDefinition<const TCode extends string>(
  definition: ProblemDefinition & { readonly code: TCode },
): RegisteredProblemDefinition & { readonly code: TCode } {
  return Object.freeze({
    ...definition,
    type: `${PROBLEM_BASE_URI}/${definition.slug}`,
  })
}

/** Immutable RFC 9457 definitions owned by the HTTP platform contribution. */
export const PROBLEM_CATALOG = Object.freeze(
  problemDefinitions.map((definition) => defineProblemDefinition(definition)),
)

const definitionsByCode: ReadonlyMap<
  CoreProblemCode,
  RegisteredProblemDefinition
> = new Map<CoreProblemCode, RegisteredProblemDefinition>(
  PROBLEM_CATALOG.map(
    (definition) =>
      [definition.code, definition] as readonly [
        CoreProblemCode,
        RegisteredProblemDefinition,
      ],
  ),
)

/** Returns one known immutable problem definition without a wire fallback. */
export function getProblemDefinition(
  code: CoreProblemCode,
): RegisteredProblemDefinition {
  const definition = definitionsByCode.get(code)
  if (definition === undefined) throw new Error(`Unknown problem code: ${code}`)
  return definition
}
