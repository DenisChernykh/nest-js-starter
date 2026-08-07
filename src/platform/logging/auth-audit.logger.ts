import type {
  StructuredLogAttribute,
  StructuredLogger,
} from './logging.contracts'

interface AuditEvent {
  readonly action: string
  readonly outcome: string
  readonly reasonCode: string
  readonly actorId?: string
  readonly sessionId?: string
  readonly targetType?: string
  readonly targetId?: string
}

const allowed = new Set([
  'login|success|LOGIN_SUCCEEDED',
  'login|denied|INVALID_CREDENTIALS',
  'login|denied|RATE_LIMITED',
  'login|denied|DEPENDENCY_UNAVAILABLE',
  'login|denied|EMAIL_VERIFICATION_REQUIRED',
  'logout|success|LOGOUT_COMPLETED',
  'logout|denied|DEPENDENCY_UNAVAILABLE',
  'logout_all|success|LOGOUT_ALL_COMPLETED',
  'logout_all|partial|CLEANUP_INCOMPLETE',
  'logout_all|denied|ACCOUNT_NOT_FOUND',
  'logout_all|denied|AUTHORIZATION_DENIED',
  'logout_all|denied|DEPENDENCY_UNAVAILABLE',
  'session_revoke|success|SESSION_REVOKED',
  'session_revoke|denied|SESSION_NOT_FOUND',
  'session_revoke|denied|DEPENDENCY_UNAVAILABLE',
  'password_change|success|PASSWORD_CHANGED',
  'password_change|denied|INVALID_CURRENT_PASSWORD',
  'password_change|denied|DEPENDENCY_UNAVAILABLE',
  'password_change|conflict|STATE_CONFLICT',
  'password_change|partial|CLEANUP_INCOMPLETE',
  'initial_admin_create|success|INITIAL_ADMIN_CREATED',
  'initial_admin_create|conflict|ALREADY_EXISTS',
  'initial_admin_create|denied|DEPENDENCY_UNAVAILABLE',
  'user_create|success|USER_CREATED',
  'user_create|conflict|EMAIL_ALREADY_EXISTS',
  'user_create|denied|UNKNOWN_ROLE',
  'user_create|denied|DEPENDENCY_UNAVAILABLE',
  'role_change|success|ROLE_CHANGED',
  'role_change|denied|ACCOUNT_NOT_FOUND',
  'role_change|denied|AUTHORIZATION_DENIED',
  'role_change|denied|UNKNOWN_ROLE',
  'role_change|denied|DEPENDENCY_UNAVAILABLE',
  'role_change|conflict|STATE_CONFLICT',
  'status_change|success|STATUS_CHANGED',
  'status_change|partial|CLEANUP_INCOMPLETE',
  'status_change|denied|ACCOUNT_NOT_FOUND',
  'status_change|denied|AUTHORIZATION_DENIED',
  'status_change|denied|DEPENDENCY_UNAVAILABLE',
  'status_change|conflict|STATE_CONFLICT',
  'account_retire|success|ACCOUNT_RETIRED',
  'account_retire|partial|CLEANUP_INCOMPLETE',
  'account_retire|denied|ACCOUNT_NOT_FOUND',
  'account_retire|denied|AUTHORIZATION_DENIED',
  'account_retire|denied|DEPENDENCY_UNAVAILABLE',
  'account_retire|conflict|STATE_CONFLICT',
  'docs_access|denied|AUTHENTICATION_REQUIRED',
  'docs_access|denied|AUTHORIZATION_DENIED',
  'docs_access|denied|DEPENDENCY_UNAVAILABLE',
  'registration|success|REGISTRATION_ACCEPTED',
  'registration|conflict|EMAIL_ALREADY_EXISTS',
  'email_verification_send|success|MAIL_DELIVERED',
  'email_verification_send|partial|MAIL_DELIVERY_FAILED',
  'email_verification_confirm|success|EMAIL_VERIFIED',
  'email_verification_confirm|denied|TOKEN_INVALID_OR_EXPIRED',
  'password_reset_request|success|MAIL_DELIVERED',
  'password_reset_request|partial|MAIL_DELIVERY_FAILED',
  'password_reset_confirm|success|PASSWORD_RESET_COMPLETED',
  'password_reset_confirm|partial|CLEANUP_INCOMPLETE',
  'password_reset_confirm|denied|TOKEN_INVALID_OR_EXPIRED',
])
const validIdentifier = /^[A-Za-z0-9_-]{1,128}$/u

/** Non-throwing finite security audit adapter backed by StructuredLogger. */
export class AuthAuditLogger {
  private failureCount = 0

  public constructor(private readonly logger: StructuredLogger) {}

  /** Validates and synchronously emits one value-free audit record. */
  public emit(event: AuditEvent): void {
    try {
      if (!validEvent(event)) throw new Error('Invalid auth audit event')
      const attributes: Record<string, StructuredLogAttribute> = {
        kind: 'audit',
        action: event.action,
        outcome: event.outcome,
        reasonCode: event.reasonCode,
      }
      for (const key of [
        'actorId',
        'sessionId',
        'targetType',
        'targetId',
      ] as const) {
        const value = event[key]
        if (value !== undefined) attributes[key] = value
      }
      this.logger.write({
        level: event.outcome === 'denied' ? 'warn' : 'info',
        event: 'auth_audit',
        module: 'AuthAudit',
        attributes,
      })
    } catch {
      this.failureCount += 1
    }
  }

  /** Returns the process-local count of dropped audit publications. */
  public getFailureCount(): number {
    return this.failureCount
  }
}

function validEvent(event: AuditEvent): boolean {
  const targetPaired =
    (event.targetType === undefined) === (event.targetId === undefined)
  const identifiers = [event.actorId, event.sessionId, event.targetId].every(
    (value) => value === undefined || validIdentifier.test(value),
  )
  return (
    allowed.has(`${event.action}|${event.outcome}|${event.reasonCode}`) &&
    targetPaired &&
    identifiers &&
    (event.targetType === undefined ||
      event.targetType === 'user' ||
      event.targetType === 'session') &&
    !(event.action === 'initial_admin_create' && event.sessionId !== undefined)
  )
}
