import type { ProblemFieldError } from './problem.contracts'

/** Value-free validation failure consumed by the global RFC 9457 filter. */
export class RequestValidationError extends Error {
  public readonly errors: readonly ProblemFieldError[]

  /** Copies and deeply freezes reviewed field issues only. */
  public constructor(errors: readonly ProblemFieldError[]) {
    super('Request validation failed')
    this.name = 'RequestValidationError'
    this.errors = Object.freeze(
      errors.map((error) => Object.freeze({ ...error })),
    )
  }
}
