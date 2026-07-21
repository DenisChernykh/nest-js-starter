import { Catch, Injectable } from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { Response } from 'express'

import {
  AuthError,
  AuthRateLimitedError,
  type AuthFailureCode,
} from '../application/auth-errors'

const statusByCode: Readonly<Record<AuthFailureCode, number>> = Object.freeze({
  AUTHENTICATION_REQUIRED: 401,
  AUTHENTICATION_FAILED: 401,
  AUTHORIZATION_DENIED: 403,
  AUTH_DEPENDENCY_UNAVAILABLE: 503,
  AUTH_RATE_LIMITED: 429,
  AUTH_SESSION_NOT_FOUND: 409,
  AUTH_STATE_CONFLICT: 409,
  AUTH_CSRF_REJECTED: 403,
})

const detailByCode: Readonly<Record<AuthFailureCode, string>> = Object.freeze({
  AUTHENTICATION_REQUIRED: 'Authentication required',
  AUTHENTICATION_FAILED: 'Authentication failed',
  AUTHORIZATION_DENIED: 'Authorization denied',
  AUTH_DEPENDENCY_UNAVAILABLE: 'Authentication dependency unavailable',
  AUTH_RATE_LIMITED: 'Too many authentication attempts',
  AUTH_SESSION_NOT_FOUND: 'Session state changed',
  AUTH_STATE_CONFLICT: 'Authentication state changed',
  AUTH_CSRF_REJECTED: 'Request rejected',
})

/** Stable temporary auth error envelope owned until the RFC 9457 slice. */
export interface AuthHttpErrorBody {
  readonly code: AuthFailureCode
  readonly detail: string
}

/** Maps only stable auth codes and never forwards exception messages. */
@Catch(AuthError)
@Injectable()
export class AuthHttpErrorMapper implements ExceptionFilter<AuthError> {
  public catch(exception: AuthError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    if (exception instanceof AuthRateLimitedError) {
      response.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil(exception.retryAfterMs / 1000))),
      )
    }
    const body: AuthHttpErrorBody = {
      code: exception.code,
      detail: detailByCode[exception.code],
    }
    response.status(statusByCode[exception.code]).json(body)
  }
}
