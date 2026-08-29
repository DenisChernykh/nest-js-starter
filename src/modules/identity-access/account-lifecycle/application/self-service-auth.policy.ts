import { AuthError } from '../../public-contracts/auth-errors'
import type { PasswordResetTokenSource } from './account-lifecycle.types'

export interface SelfServiceAuthPolicyConfig {
  readonly mode: 'disabled' | 'open'
  readonly publicAppUrl?: string
  readonly verificationTtlMs: number
  readonly passwordResetTtlMs: number
  readonly emailWorkflowsEnabled?: boolean
}

export class SelfServiceDisabledError extends AuthError {
  public constructor() {
    super('AUTH_SESSION_NOT_FOUND', 'Not found')
    this.name = 'SelfServiceDisabledError'
  }
}

export class AuthTokenInvalidOrExpiredError extends AuthError {
  public constructor() {
    super('AUTH_STATE_CONFLICT', 'Authentication token invalid or expired')
    this.name = 'AuthTokenInvalidOrExpiredError'
  }
}

export class SelfServiceAuthPolicy {
  public constructor(private readonly config: SelfServiceAuthPolicyConfig) {}

  public get settings(): SelfServiceAuthPolicyConfig {
    return this.config
  }

  public assertOpen(): void {
    if (this.config.mode !== 'open') throw new SelfServiceDisabledError()
  }

  public assertPasswordResetConfirmationEnabled(): void {
    if (this.config.mode !== 'open' && !this.config.emailWorkflowsEnabled)
      throw new SelfServiceDisabledError()
  }

  public allowsPasswordResetSource(source: PasswordResetTokenSource): boolean {
    return source === 'self-service'
      ? this.config.mode === 'open'
      : this.config.emailWorkflowsEnabled === true
  }

  public verificationUrl(rawToken: string): string {
    return `${this.origin()}/auth/verify-email#token=${rawToken}`
  }

  public resetUrl(rawToken: string): string {
    return `${this.origin()}/auth/reset-password#token=${rawToken}`
  }

  private origin(): string {
    if (this.config.publicAppUrl === undefined) {
      throw new Error('Self-service app origin is unavailable')
    }
    return this.config.publicAppUrl
  }
}
