import type { AdminAccount } from '../application/account-administration.port'
import { AuthError } from '../application/auth-errors'

export class AccountEtagPreconditionRequiredError extends AuthError {
  public constructor() {
    super('AUTH_STATE_CONFLICT', 'The If-Match header is required')
    this.name = 'AccountEtagPreconditionRequiredError'
  }
}

export class AccountEtagMalformedError extends AuthError {
  public constructor() {
    super('AUTH_STATE_CONFLICT', 'The If-Match header is malformed')
    this.name = 'AccountEtagMalformedError'
  }
}

export function formatAccountEtag(
  account: Pick<AdminAccount, 'id' | 'revision'>,
): string {
  return `"account-${account.id}-${account.revision}"`
}

export function parseAccountEtag(
  accountId: string,
  value: string | undefined,
): number {
  if (value === undefined || value.trim() === '')
    throw new AccountEtagPreconditionRequiredError()
  const match =
    /^"account-([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})-([0-9]+)"$/iu.exec(
      value.trim(),
    )
  if (match === null || match[1]?.toLowerCase() !== accountId.toLowerCase())
    throw new AccountEtagMalformedError()
  const revision = Number(match[2])
  if (!Number.isSafeInteger(revision)) throw new AccountEtagMalformedError()
  return revision
}
