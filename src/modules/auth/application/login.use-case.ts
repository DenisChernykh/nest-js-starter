import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthenticationFailedError,
  AuthRateLimitedError,
} from './auth-errors'
import type { AuthPersistencePort } from './auth-persistence.port'
import type { LoginRateLimiterPort } from './login-rate-limiter.port'
import type { PasswordHasherPort } from './password-hasher.port'
import type {
  IssuedBrowserSession,
  SessionStorePort,
} from './session-store.port'
import { NOOP_AUTH_AUDIT, type AuthAuditPort } from './auth-audit.port'

/** Untrusted login fields plus safe request metadata. */
export interface LoginInput {
  readonly email: string
  readonly password: string
  readonly ipAddress: string
  readonly nowMs: number
  readonly deviceLabel: string
  readonly networkFingerprint: string
}

/** Executes generic-failure login and issues an opaque browser session. */
export class LoginUseCase {
  public constructor(
    private readonly persistence: AuthPersistencePort,
    private readonly passwords: PasswordHasherPort,
    private readonly limiter: LoginRateLimiterPort,
    private readonly sessions: SessionStorePort,
    private readonly dummyPasswordHash: string,
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public async execute(input: LoginInput): Promise<IssuedBrowserSession> {
    return this.performLogin(input)
  }

  private async performLogin(input: LoginInput): Promise<IssuedBrowserSession> {
    const normalizedEmail = input.email.trim().toLowerCase()
    try {
      const decision = await this.limiter.consume({
        ipAddress: input.ipAddress,
        normalizedEmail,
      })
      if (!decision.allowed)
        throw new AuthRateLimitedError(decision.retryAfterMs)
      const snapshot =
        await this.persistence.findCredentialByNormalizedEmail(normalizedEmail)
      const verification = await this.passwords.verify(
        input.password,
        snapshot?.passwordHash ?? this.dummyPasswordHash,
      )
      if (
        snapshot === undefined ||
        !verification.matches ||
        snapshot.status !== 'active'
      ) {
        throw new AuthenticationFailedError()
      }
      if (verification.needsRehash) {
        const upgraded = await this.passwords.hash(input.password)
        await this.persistence.replacePasswordIfVersion(
          snapshot.userId,
          snapshot.passwordVersion,
          upgraded,
        )
      }
      const globalSessionEpoch = await this.persistence.readGlobalSessionEpoch()
      const session = await this.sessions.issue({
        userId: snapshot.userId,
        sessionGeneration: snapshot.sessionGeneration,
        globalSessionEpoch,
        nowMs: input.nowMs,
        deviceLabel: input.deviceLabel,
        networkFingerprint: input.networkFingerprint,
      })
      this.audit.emit({
        action: 'login',
        outcome: 'success',
        reasonCode: 'LOGIN_SUCCEEDED',
        actorId: snapshot.userId,
        sessionId: session.publicId,
        targetType: 'session',
        targetId: session.publicId,
      })
      return session
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        this.audit.emit({
          action: 'login',
          outcome: 'denied',
          reasonCode:
            error.code === 'AUTH_RATE_LIMITED'
              ? 'RATE_LIMITED'
              : error.code === 'AUTHENTICATION_FAILED'
                ? 'INVALID_CREDENTIALS'
                : 'DEPENDENCY_UNAVAILABLE',
        })
        throw error
      }
      this.audit.emit({
        action: 'login',
        outcome: 'denied',
        reasonCode: 'DEPENDENCY_UNAVAILABLE',
      })
      throw new AuthDependencyUnavailableError()
    }
  }
}
