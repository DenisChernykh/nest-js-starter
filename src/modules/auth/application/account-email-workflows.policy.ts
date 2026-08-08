import { AuthError } from './auth-errors'

export interface AccountEmailWorkflowsPolicyConfig {
  readonly mode: 'disabled' | 'enabled'
  readonly invitationTtlMs: number
  readonly passwordResetTtlMs: number
  readonly publicAppUrl?: string
}

export class AccountEmailWorkflowsDisabledError extends AuthError {
  public constructor() {
    super('AUTH_SESSION_NOT_FOUND', 'Not found')
    this.name = 'AccountEmailWorkflowsDisabledError'
  }
}

export class AccountEmailWorkflowsPolicy {
  public constructor(
    private readonly config: AccountEmailWorkflowsPolicyConfig,
  ) {}

  public get settings(): AccountEmailWorkflowsPolicyConfig {
    return this.config
  }

  public assertEnabled(): void {
    if (this.config.mode !== 'enabled')
      throw new AccountEmailWorkflowsDisabledError()
  }

  public invitationUrl(rawToken: string): string {
    this.assertEnabled()
    if (this.config.publicAppUrl === undefined)
      throw new Error('Account email workflow app origin is unavailable')
    return `${this.config.publicAppUrl}/auth/accept-invitation#token=${rawToken}`
  }
}
