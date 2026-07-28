import { ApplicationError } from '@/shared/application/application.error'

/** Stable framework-free auth failure codes exposed at transport boundaries. */
export type AuthFailureCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_DENIED'
  | 'AUTH_DEPENDENCY_UNAVAILABLE'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_SESSION_NOT_FOUND'
  | 'AUTH_STATE_CONFLICT'
  | 'AUTH_CSRF_REJECTED'

/** Base error that carries only a stable auth code and internal detail. */
export class AuthError extends ApplicationError<AuthFailureCode> {
  public constructor(code: AuthFailureCode, detail: string) {
    super(code, detail)
    this.name = 'AuthError'
  }
}

/** Fail-closed result for a durable role unknown to the code registry. */
export class UnknownRoleAssignmentError extends AuthError {
  public constructor() {
    super('AUTHENTICATION_FAILED', 'Authentication failed')
    this.name = 'UnknownRoleAssignmentError'
  }
}

/** Fail-closed result for an account disabled in durable state. */
export class DisabledUserError extends AuthError {
  public constructor() {
    super('AUTHENTICATION_FAILED', 'Authentication failed')
    this.name = 'DisabledUserError'
  }
}

/** Stable dependency failure that never retains password or PHC text. */
export class PasswordHashingError extends AuthError {
  public constructor() {
    super('AUTH_DEPENDENCY_UNAVAILABLE', 'Credential processing unavailable')
    this.name = 'PasswordHashingError'
  }
}

/** Redacted failure for required PostgreSQL or Redis auth state. */
export class AuthDependencyUnavailableError extends AuthError {
  public constructor() {
    super(
      'AUTH_DEPENDENCY_UNAVAILABLE',
      'Authentication dependency unavailable',
    )
    this.name = 'AuthDependencyUnavailableError'
  }
}

/** Generic credential failure shared by missing, wrong and disabled accounts. */
export class AuthenticationFailedError extends AuthError {
  public constructor() {
    super('AUTHENTICATION_FAILED', 'Authentication failed')
    this.name = 'AuthenticationFailedError'
  }
}

/** Missing, expired or durably stale browser authentication state. */
export class AuthenticationRequiredError extends AuthError {
  public constructor() {
    super('AUTHENTICATION_REQUIRED', 'Authentication required')
    this.name = 'AuthenticationRequiredError'
  }
}

/** Authenticated principal lacks one or more endpoint permissions. */
export class AuthorizationDeniedError extends AuthError {
  public constructor() {
    super('AUTHORIZATION_DENIED', 'Authorization denied')
    this.name = 'AuthorizationDeniedError'
  }
}

/** Browser request failed the trusted-origin or session CSRF policy. */
export class AuthCsrfRejectedError extends AuthError {
  public constructor() {
    super('AUTH_CSRF_REJECTED', 'Request rejected')
    this.name = 'AuthCsrfRejectedError'
  }
}

/** Stable optimistic-concurrency conflict for credential state. */
export class AuthStateConflictError extends AuthError {
  public constructor() {
    super('AUTH_STATE_CONFLICT', 'Authentication state changed')
    this.name = 'AuthStateConflictError'
  }
}

/** Atomic login limiter denial with bounded retry metadata. */
export class AuthRateLimitedError extends AuthError {
  public constructor(public readonly retryAfterMs: number) {
    super('AUTH_RATE_LIMITED', 'Too many authentication attempts')
    this.name = 'AuthRateLimitedError'
  }
}
