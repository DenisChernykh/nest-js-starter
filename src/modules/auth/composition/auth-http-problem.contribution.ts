import {
  AuthError,
  type AuthFailureCode,
  EmailVerificationRequiredError,
  AuthRateLimitedError,
} from '../application/auth-errors'
import {
  AccountEtagMalformedError,
  AccountEtagPreconditionFailedError,
  AccountEtagPreconditionRequiredError,
} from '../application/account-administration.service'
import { AuthTokenInvalidOrExpiredError } from '../application/self-service-auth.policy'
import {
  AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM,
  AUTH_ACCOUNT_ETAG_MALFORMED_PROBLEM,
  AUTH_ACCOUNT_PRECONDITION_FAILED_PROBLEM,
  AUTH_ACCOUNT_PRECONDITION_REQUIRED_PROBLEM,
  EMAIL_VERIFICATION_REQUIRED_PROBLEM,
} from '../presentation/auth-problem.definitions'
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
    definitions: Object.freeze([
      EMAIL_VERIFICATION_REQUIRED_PROBLEM,
      AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM,
      AUTH_ACCOUNT_ETAG_MALFORMED_PROBLEM,
      AUTH_ACCOUNT_PRECONDITION_REQUIRED_PROBLEM,
      AUTH_ACCOUNT_PRECONDITION_FAILED_PROBLEM,
    ]),
    map: mapAuthHttpProblem,
  })

function mapAuthHttpProblem(error: unknown): HttpProblemMapping | undefined {
  if (error instanceof EmailVerificationRequiredError) {
    return { code: EMAIL_VERIFICATION_REQUIRED_PROBLEM.code }
  }
  if (error instanceof AuthTokenInvalidOrExpiredError) {
    return { code: AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM.code }
  }
  if (error instanceof AccountEtagMalformedError) {
    return { code: AUTH_ACCOUNT_ETAG_MALFORMED_PROBLEM.code }
  }
  if (error instanceof AccountEtagPreconditionRequiredError) {
    return { code: AUTH_ACCOUNT_PRECONDITION_REQUIRED_PROBLEM.code }
  }
  if (error instanceof AccountEtagPreconditionFailedError) {
    return { code: AUTH_ACCOUNT_PRECONDITION_FAILED_PROBLEM.code }
  }
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
