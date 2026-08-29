import { AuthError } from '../../public-contracts/auth-errors'

export class AccountRevisionConflictError extends AuthError {
  public constructor() {
    super('AUTH_STATE_CONFLICT', 'The account state has changed')
    this.name = 'AccountRevisionConflictError'
  }
}

export class AccountRoleUnknownError extends AuthError {
  public constructor() {
    super('AUTH_STATE_CONFLICT', 'One or more account roles are unknown')
    this.name = 'AccountRoleUnknownError'
  }
}

export class AccountNotFoundError extends AuthError {
  public constructor() {
    super('AUTH_SESSION_NOT_FOUND', 'Account not found')
    this.name = 'AccountNotFoundError'
  }
}

export class AccountAdministrationDisabledError extends AuthError {
  public constructor() {
    super('AUTH_SESSION_NOT_FOUND', 'Account administration is disabled')
    this.name = 'AccountAdministrationDisabledError'
  }
}

export class AccountSelfMutationForbiddenError extends AuthError {
  public constructor() {
    super('AUTHORIZATION_DENIED', 'Self account mutation is forbidden')
    this.name = 'AccountSelfMutationForbiddenError'
  }
}
