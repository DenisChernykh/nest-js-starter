import {
  AuthError,
  type AuthFailureCode,
  AuthRateLimitedError,
} from '../application/auth-errors'
import type {
  HttpProblemContribution,
  HttpProblemMapping,
} from '@/platform/http/errors/problem.contracts'
import type { CoreProblemCode } from '@/platform/http/errors/problem-registry'

/** Exhaustive projection from application-owned auth codes to core problems. */
export const AUTH_FAILURE_PROBLEM_CODES = Object.freeze({
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_REQUIRED',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
  AUTH_DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  AUTH_RATE_LIMITED: 'RATE_LIMIT_EXCEEDED',
  AUTH_SESSION_NOT_FOUND: 'NOT_FOUND',
  AUTH_STATE_CONFLICT: 'CONFLICT',
  AUTH_CSRF_REJECTED: 'AUTHORIZATION_DENIED',
} as const satisfies Readonly<Record<AuthFailureCode, CoreProblemCode>>)

/** Auth composition contribution recognizing only the module's error base. */
export const AUTH_HTTP_PROBLEM_CONTRIBUTION: HttpProblemContribution =
  Object.freeze({
    definitions: Object.freeze([]),
    map: mapAuthHttpProblem,
  })

function mapAuthHttpProblem(error: unknown): HttpProblemMapping | undefined {
  if (!(error instanceof AuthError)) return undefined
  return {
    code: AUTH_FAILURE_PROBLEM_CODES[error.code],
    ...(error instanceof AuthRateLimitedError
      ? { retryAfterSeconds: readRetryAfterSeconds(error.retryAfterMs) }
      : {}),
  }
}

function readRetryAfterSeconds(retryAfterMs: number): number {
  const boundedRetryAfterMs = Number.isFinite(retryAfterMs)
    ? retryAfterMs
    : 1_000
  return Math.max(1, Math.ceil(boundedRetryAfterMs / 1_000))
}
