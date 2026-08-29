import type {
  AuthAuditAction,
  AuthAuditPort,
} from '../../public-contracts/auth-audit.port'
import { canonicalizeUserId } from '../../public-contracts/canonical-user-id'
import {
  AccountEtagMalformedError,
  AccountEtagPreconditionRequiredError,
  parseAccountEtag,
} from './account-etag.codec'

type AccountEtagMutationAction = Extract<
  AuthAuditAction,
  'status_change' | 'role_change' | 'account_retire'
>

export function parseAuditedAccountEtag(
  audit: AuthAuditPort,
  input: {
    readonly action: AccountEtagMutationAction
    readonly actorId: string
    readonly accountId: string
    readonly value: string | undefined
  },
): number {
  const actorId = canonicalizeUserId(input.actorId)
  const accountId = canonicalizeUserId(input.accountId)
  try {
    return parseAccountEtag(accountId, input.value)
  } catch (error: unknown) {
    if (
      error instanceof AccountEtagPreconditionRequiredError ||
      error instanceof AccountEtagMalformedError
    ) {
      audit.emit({
        action: input.action,
        outcome: 'conflict',
        reasonCode: 'STATE_CONFLICT',
        actorId,
        targetType: 'user',
        targetId: accountId,
      })
    }
    throw error
  }
}
