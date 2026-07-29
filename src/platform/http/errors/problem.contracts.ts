/** One value-free request field issue addressed by RFC 6901 JSON Pointer. */
export interface ProblemFieldError {
  readonly pointer: string
  readonly code: string
  readonly detail: string
}

/** Canonical RFC 9457 response body enriched with stable machine identifiers. */
export interface ProblemDocument {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly detail: string
  readonly instance: string
  readonly code: string
  readonly requestId: string
  readonly errors?: readonly ProblemFieldError[]
}

/** Source definition for one stable starter-owned problem type. */
export interface ProblemDefinition {
  readonly slug: string
  readonly title: string
  readonly status: number
  readonly code: string
  readonly detail: string
}

/** Immutable problem definition with its committed absolute type URI. */
export interface RegisteredProblemDefinition extends ProblemDefinition {
  readonly type: string
}

/** Safe public metadata returned by one contributed application mapper. */
export interface HttpProblemMapping {
  readonly code: string
  readonly errors?: readonly ProblemFieldError[]
  readonly retryAfterSeconds?: number
}

/** Framework-bound projection from an explicit error class to public metadata. */
export type HttpProblemMapper = (
  error: unknown,
) => HttpProblemMapping | undefined

/** Module-owned definitions and mapper installed by a composition root. */
export interface HttpProblemContribution {
  readonly definitions: readonly RegisteredProblemDefinition[]
  readonly map: HttpProblemMapper
}

/** Fully resolved safe problem consumed by the global exception filter. */
export interface MappedHttpProblem {
  readonly definition: RegisteredProblemDefinition
  readonly errors?: readonly ProblemFieldError[]
  readonly retryAfterSeconds?: number
  readonly unexpected: boolean
}
