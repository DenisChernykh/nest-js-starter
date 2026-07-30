import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'

describe('AuthAuditLogger', () => {
  it.each([
    ['login', 'success', 'LOGIN_SUCCEEDED'],
    ['login', 'denied', 'INVALID_CREDENTIALS'],
    ['login', 'denied', 'RATE_LIMITED'],
    ['login', 'denied', 'DEPENDENCY_UNAVAILABLE'],
    ['logout', 'success', 'LOGOUT_COMPLETED'],
    ['logout_all', 'success', 'LOGOUT_ALL_COMPLETED'],
    ['logout_all', 'partial', 'CLEANUP_INCOMPLETE'],
    ['session_revoke', 'success', 'SESSION_REVOKED'],
    ['session_revoke', 'denied', 'SESSION_NOT_FOUND'],
    ['password_change', 'success', 'PASSWORD_CHANGED'],
    ['password_change', 'denied', 'INVALID_CURRENT_PASSWORD'],
    ['password_change', 'conflict', 'STATE_CONFLICT'],
    ['password_change', 'partial', 'CLEANUP_INCOMPLETE'],
    ['initial_admin_create', 'success', 'INITIAL_ADMIN_CREATED'],
    ['initial_admin_create', 'conflict', 'ALREADY_EXISTS'],
    ['initial_admin_create', 'denied', 'DEPENDENCY_UNAVAILABLE'],
    ['user_create', 'success', 'USER_CREATED'],
    ['user_create', 'conflict', 'EMAIL_ALREADY_EXISTS'],
    ['user_create', 'denied', 'UNKNOWN_ROLE'],
    ['user_create', 'denied', 'DEPENDENCY_UNAVAILABLE'],
    ['docs_access', 'denied', 'AUTHENTICATION_REQUIRED'],
    ['docs_access', 'denied', 'AUTHORIZATION_DENIED'],
    ['docs_access', 'denied', 'DEPENDENCY_UNAVAILABLE'],
  ] as const)('accepts %s/%s/%s', (action, outcome, reasonCode) => {
    const sink = { write: jest.fn() }
    const logger = new AuthAuditLogger(sink)

    expect(() => logger.emit({ action, outcome, reasonCode })).not.toThrow()
    expect(sink.write.mock.calls).toEqual([
      [
        {
          level: outcome === 'denied' ? 'warn' : 'info',
          event: 'auth_audit',
          module: 'AuthAudit',
          attributes: { kind: 'audit', action, outcome, reasonCode },
        },
      ],
    ])
    expect(logger.getFailureCount()).toBe(0)
  })

  it.each([
    { action: 'login', outcome: 'success', reasonCode: 'UNKNOWN' },
    { action: 'login', outcome: 'partial', reasonCode: 'LOGIN_SUCCEEDED' },
    {
      action: 'initial_admin_create',
      outcome: 'success',
      reasonCode: 'INITIAL_ADMIN_CREATED',
      sessionId: 'forbidden',
    },
    {
      action: 'login',
      outcome: 'success',
      reasonCode: 'LOGIN_SUCCEEDED',
      targetType: 'user',
    },
  ] as const)('drops invalid schema without throwing: %#', (event) => {
    const sink = { write: jest.fn() }
    const logger = new AuthAuditLogger(sink)

    expect(() => logger.emit(event)).not.toThrow()
    expect(sink.write).not.toHaveBeenCalled()
    expect(logger.getFailureCount()).toBe(1)
  })

  it('allows only contextually valid identifiers and never email/IP/secret fields', () => {
    const sink = { write: jest.fn() }
    const logger = new AuthAuditLogger(sink)

    logger.emit({
      action: 'session_revoke',
      outcome: 'success',
      reasonCode: 'SESSION_REVOKED',
      actorId: 'user-1',
      sessionId: 'current-session',
      targetType: 'session',
      targetId: 'revoked-session',
    })

    const serialized = JSON.stringify(sink.write.mock.calls)
    expect(serialized).toContain('revoked-session')
    for (const forbidden of [
      'email',
      'password',
      'token',
      'cookie',
      'ipAddress',
      'url',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('contains sink failures and increments its internal diagnostic counter', () => {
    const logger = new AuthAuditLogger({
      write: () => {
        throw new Error('sink unavailable')
      },
    })

    expect(() =>
      logger.emit({
        action: 'logout',
        outcome: 'success',
        reasonCode: 'LOGOUT_COMPLETED',
      }),
    ).not.toThrow()
    expect(logger.getFailureCount()).toBe(1)
  })
})
