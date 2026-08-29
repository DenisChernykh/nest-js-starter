import { ApplicationError } from '@/shared/application/application.error'

export type AuthFailureCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_DENIED'
  | 'AUTH_DEPENDENCY_UNAVAILABLE'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_SESSION_NOT_FOUND'
  | 'AUTH_STATE_CONFLICT'
  | 'AUTH_CSRF_REJECTED'

export class AuthError extends ApplicationError<AuthFailureCode> {
  public constructor(code: AuthFailureCode, detail: string) {
    super(code, detail)
    this.name = 'AuthError'
  }
}

export class AuthenticationRequiredError extends AuthError {
  public constructor() {
    super('AUTHENTICATION_REQUIRED', 'Authentication required')
    this.name = 'AuthenticationRequiredError'
  }
}
