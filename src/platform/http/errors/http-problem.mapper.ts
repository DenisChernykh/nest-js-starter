import { HttpException } from '@nestjs/common'

import type {
  ProblemFieldError,
  RegisteredProblemDefinition,
} from './problem.contracts'
import { PROBLEM_REGISTRY, type ProblemCode } from './problem-registry'
import { RequestValidationError } from './request-validation.error'

/** Exhaustive transport translation table verified against AuthFailureCode. */
export const AUTH_FAILURE_PROBLEM_CODES = Object.freeze({
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_REQUIRED',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
  AUTH_DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  AUTH_RATE_LIMITED: 'RATE_LIMIT_EXCEEDED',
  AUTH_SESSION_NOT_FOUND: 'NOT_FOUND',
  AUTH_STATE_CONFLICT: 'CONFLICT',
  AUTH_CSRF_REJECTED: 'AUTHORIZATION_DENIED',
} as const satisfies Readonly<Record<string, ProblemCode>>)

const httpProblemCodes: Readonly<Record<number, ProblemCode>> = Object.freeze({
  400: 'MALFORMED_REQUEST',
  401: 'AUTHENTICATION_REQUIRED',
  403: 'AUTHORIZATION_DENIED',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMIT_EXCEEDED',
  503: 'DEPENDENCY_UNAVAILABLE',
})

/** Safe mapping result consumed by the sole global HTTP exception filter. */
export interface MappedHttpProblem {
  readonly definition: RegisteredProblemDefinition
  readonly errors?: readonly ProblemFieldError[]
  readonly retryAfterSeconds?: number
  readonly unexpected: boolean
}

/**
 * Maps known framework and structural application failures to public problems.
 *
 * @param error - Unknown failure captured at the HTTP transport boundary.
 * @returns A definition containing no exception message, cause or stack data.
 */
export function mapHttpProblem(error: unknown): MappedHttpProblem {
  if (error instanceof RequestValidationError) {
    return {
      definition: PROBLEM_REGISTRY.get('VALIDATION_FAILED'),
      errors: error.errors,
      unexpected: false,
    }
  }

  const authCode = readAuthFailureCode(error)
  if (authCode !== undefined) {
    const problemCode = AUTH_FAILURE_PROBLEM_CODES[authCode]
    return {
      definition: PROBLEM_REGISTRY.get(problemCode),
      ...(authCode === 'AUTH_RATE_LIMITED'
        ? { retryAfterSeconds: readRetryAfterSeconds(error) }
        : {}),
      unexpected: false,
    }
  }

  if (isPayloadTooLargeError(error)) {
    return {
      definition: PROBLEM_REGISTRY.get('PAYLOAD_TOO_LARGE'),
      unexpected: false,
    }
  }

  if (error instanceof HttpException) {
    const problemCode = httpProblemCodes[error.getStatus()]
    if (problemCode !== undefined) {
      return {
        definition: PROBLEM_REGISTRY.get(problemCode),
        unexpected: false,
      }
    }
  }

  return {
    definition: PROBLEM_REGISTRY.get('INTERNAL_ERROR'),
    unexpected: true,
  }
}

function isPayloadTooLargeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'type' in error &&
    error.type === 'entity.too.large' &&
    'status' in error &&
    error.status === 413
  )
}

type AuthFailureCodeKey = keyof typeof AUTH_FAILURE_PROBLEM_CODES

function readAuthFailureCode(error: unknown): AuthFailureCodeKey | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  const code = error.code
  return typeof code === 'string' &&
    Object.hasOwn(AUTH_FAILURE_PROBLEM_CODES, code)
    ? (code as AuthFailureCodeKey)
    : undefined
}

function readRetryAfterSeconds(error: unknown): number {
  const retryAfterMs =
    error instanceof Error &&
    'retryAfterMs' in error &&
    typeof error.retryAfterMs === 'number' &&
    Number.isFinite(error.retryAfterMs)
      ? error.retryAfterMs
      : 1_000
  return Math.max(1, Math.ceil(retryAfterMs / 1_000))
}
