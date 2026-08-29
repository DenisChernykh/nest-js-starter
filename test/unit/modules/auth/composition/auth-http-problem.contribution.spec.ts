import {
  AuthDependencyUnavailableError,
  AuthError,
  EmailVerificationRequiredError,
  type AuthFailureCode,
  AuthRateLimitedError,
} from '@/modules/auth/application/auth-errors'
import { AuthTokenInvalidOrExpiredError } from '@/modules/auth/application/self-service-auth.policy'
import { AccountRevisionConflictError } from '@/modules/auth/application/account-administration.service'
import {
  AUTH_FAILURE_PROBLEM_CODES,
  AUTH_HTTP_PROBLEM_CONTRIBUTION,
} from '@/modules/auth/composition/auth-http-problem.contribution'
import {
  AUTH_ACCOUNT_ETAG_MALFORMED_PROBLEM,
  AUTH_ACCOUNT_PRECONDITION_FAILED_PROBLEM,
  AUTH_ACCOUNT_PRECONDITION_REQUIRED_PROBLEM,
  AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM,
  EMAIL_VERIFICATION_REQUIRED_PROBLEM,
} from '@/modules/auth/presentation/auth-problem.definitions'
import { CORE_HTTP_PROBLEM_CONTRIBUTION } from '@/platform/http/errors/http-problem.mapper'
import { HttpProblemRegistry } from '@/platform/http/errors/http-problem.registry'
import type { CoreProblemCode } from '@/platform/http/errors/problem-registry'
import {
  AccountEtagMalformedError,
  AccountEtagPreconditionRequiredError,
} from '@/modules/auth/presentation/account-etag.codec'

const registry = new HttpProblemRegistry([
  CORE_HTTP_PROBLEM_CONTRIBUTION,
  AUTH_HTTP_PROBLEM_CONTRIBUTION,
])

describe('AUTH_HTTP_PROBLEM_CONTRIBUTION', () => {
  it('registers auth-owned lifecycle and account-precondition problems', () => {
    expect(AUTH_HTTP_PROBLEM_CONTRIBUTION.definitions).toEqual([
      EMAIL_VERIFICATION_REQUIRED_PROBLEM,
      AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM,
      AUTH_ACCOUNT_ETAG_MALFORMED_PROBLEM,
      AUTH_ACCOUNT_PRECONDITION_REQUIRED_PROBLEM,
      AUTH_ACCOUNT_PRECONDITION_FAILED_PROBLEM,
    ])
    expect(
      registry.map(new EmailVerificationRequiredError()).definition,
    ).toEqual(EMAIL_VERIFICATION_REQUIRED_PROBLEM)
    expect(
      registry.map(new AuthTokenInvalidOrExpiredError()).definition,
    ).toEqual(AUTH_TOKEN_INVALID_OR_EXPIRED_PROBLEM)
    expect(registry.map(new AccountEtagMalformedError()).definition).toEqual(
      AUTH_ACCOUNT_ETAG_MALFORMED_PROBLEM,
    )
    expect(
      registry.map(new AccountEtagPreconditionRequiredError()).definition,
    ).toEqual(AUTH_ACCOUNT_PRECONDITION_REQUIRED_PROBLEM)
    expect(registry.map(new AccountRevisionConflictError()).definition).toEqual(
      AUTH_ACCOUNT_PRECONDITION_FAILED_PROBLEM,
    )
  })

  it('keeps the auth failure mapping exhaustive at compile time', () => {
    const completeMapping: Readonly<Record<AuthFailureCode, CoreProblemCode>> =
      AUTH_FAILURE_PROBLEM_CODES

    expect(completeMapping).toBe(AUTH_FAILURE_PROBLEM_CODES)
  })

  it.each([
    ['AUTHENTICATION_REQUIRED', 'AUTHENTICATION_REQUIRED', 401],
    ['AUTHENTICATION_FAILED', 'AUTHENTICATION_REQUIRED', 401],
    ['AUTHORIZATION_DENIED', 'AUTHORIZATION_DENIED', 403],
    ['AUTH_CSRF_REJECTED', 'AUTHORIZATION_DENIED', 403],
    ['AUTH_SESSION_NOT_FOUND', 'NOT_FOUND', 404],
    ['AUTH_STATE_CONFLICT', 'CONFLICT', 409],
    ['AUTH_DEPENDENCY_UNAVAILABLE', 'DEPENDENCY_UNAVAILABLE', 503],
  ] as const)(
    'maps explicit auth error %s to %s',
    (authCode, problemCode, status) => {
      const mapped = registry.map(
        new AuthError(authCode, 'private auth detail'),
      )

      expect(mapped.definition.code).toBe(problemCode)
      expect(mapped.definition.status).toBe(status)
      expect(mapped.unexpected).toBe(false)
      expect(JSON.stringify(mapped)).not.toContain('private auth detail')
    },
  )

  it('projects bounded retry metadata only from AuthRateLimitedError', () => {
    const mapped = registry.map(new AuthRateLimitedError(1_001))

    expect(mapped.definition.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(mapped.retryAfterSeconds).toBe(2)
    expect(mapped.unexpected).toBe(false)
  })

  it('recognizes only AuthError instances', () => {
    const mapped = registry.map(
      Object.assign(new Error('private auth detail'), {
        code: 'AUTH_DEPENDENCY_UNAVAILABLE',
      }),
    )

    expect(mapped.definition.code).toBe('INTERNAL_ERROR')
    expect(mapped.unexpected).toBe(true)
    expect(
      registry.map(new AuthDependencyUnavailableError()).definition.code,
    ).toBe('DEPENDENCY_UNAVAILABLE')
  })
})
