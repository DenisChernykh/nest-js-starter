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
