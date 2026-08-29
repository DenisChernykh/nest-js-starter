import { AuthError } from '../../public-contracts/auth-errors'

export class AccountLifecycleRoleUnknownError extends AuthError {
  public constructor() {
    super('AUTH_STATE_CONFLICT', 'One or more account roles are unknown')
    this.name = 'AccountLifecycleRoleUnknownError'
  }
}

export class AccountEmailAlreadyExistsError extends AuthError {
  public constructor() {
    super('AUTH_STATE_CONFLICT', 'An account already uses this email')
    this.name = 'AccountEmailAlreadyExistsError'
  }
}

export class AccountEmailWorkflowTargetUnavailableError extends AuthError {
  public constructor() {
    super(
      'AUTH_STATE_CONFLICT',
      'The account is not eligible for this workflow',
    )
    this.name = 'AccountEmailWorkflowTargetUnavailableError'
  }
}

export class AccountLifecycleSelfMutationForbiddenError extends AuthError {
  public constructor() {
    super('AUTHORIZATION_DENIED', 'Self account mutation is forbidden')
    this.name = 'AccountLifecycleSelfMutationForbiddenError'
  }
}
