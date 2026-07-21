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

/** Base error that carries only a stable auth code and safe detail. */
export class AuthError extends Error {
  public constructor(
    public readonly code: AuthFailureCode,
    detail: string,
  ) {
    super(detail)
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
