/** Finite security-sensitive auth actions emitted after known outcomes. */
export type AuthAuditAction =
  | 'login'
  | 'logout'
  | 'logout_all'
  | 'session_revoke'
  | 'password_change'
  | 'initial_admin_create'
  | 'role_change'
  | 'status_change'
  | 'docs_access'

/** Reviewed result classes shared by all auth audit actions. */
export type AuthAuditOutcome = 'success' | 'denied' | 'partial' | 'conflict'

/** Value-free auth security event accepted by the audit adapter. */
export interface AuthAuditEvent {
  readonly action: AuthAuditAction
  readonly outcome: AuthAuditOutcome
  readonly reasonCode: string
  readonly actorId?: string
  readonly sessionId?: string
  readonly targetType?: 'user' | 'session'
  readonly targetId?: string
}

/** Synchronous non-throwing security audit boundary for auth use cases. */
export interface AuthAuditPort {
  emit(event: AuthAuditEvent): void
}

/** Injection token for security-sensitive auth audit events. */
export const AUTH_AUDIT: unique symbol = Symbol('AUTH_AUDIT')

/** No-op audit boundary used only by isolated application construction. */
export const NOOP_AUTH_AUDIT: AuthAuditPort = Object.freeze({
  emit: () => undefined,
})
