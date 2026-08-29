import { parseAuditedAccountEtag } from '@/modules/identity-access/account-administration/presentation/audited-account-etag'
import {
  AccountEtagMalformedError,
  AccountEtagPreconditionRequiredError,
} from '@/modules/identity-access/account-administration/presentation/account-etag.codec'
import type {
  AuthAuditAction,
  AuthAuditEvent,
} from '@/modules/identity-access/public-contracts/auth-audit.port'

const actorId = '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123'
const accountId = '95ee8d48-2f19-49be-af21-c5f471c1e502'
const actions = [
  'status_change',
  'role_change',
  'account_retire',
] as const satisfies readonly AuthAuditAction[]

describe('audited account ETag parsing', () => {
  it.each(actions)(
    'audits a missing If-Match for %s without changing the presentation error',
    (action) => {
      const events: AuthAuditEvent[] = []

      expect(() =>
        parseAuditedAccountEtag(
          { emit: (event) => events.push(event) },
          {
            action,
            actorId: actorId.toUpperCase(),
            accountId: accountId.toUpperCase(),
            value: undefined,
          },
        ),
      ).toThrow(AccountEtagPreconditionRequiredError)
      expect(events).toEqual([
        {
          action,
          outcome: 'conflict',
          reasonCode: 'STATE_CONFLICT',
          actorId,
          targetType: 'user',
          targetId: accountId,
        },
      ])
    },
  )

  it.each(actions)(
    'audits a malformed If-Match for %s exactly once',
    (action) => {
      const events: AuthAuditEvent[] = []

      expect(() =>
        parseAuditedAccountEtag(
          { emit: (event) => events.push(event) },
          { action, actorId, accountId, value: 'malformed' },
        ),
      ).toThrow(AccountEtagMalformedError)
      expect(events).toEqual([
        {
          action,
          outcome: 'conflict',
          reasonCode: 'STATE_CONFLICT',
          actorId,
          targetType: 'user',
          targetId: accountId,
        },
      ])
    },
  )

  it('returns a valid revision without emitting an audit event', () => {
    const events: AuthAuditEvent[] = []

    expect(
      parseAuditedAccountEtag(
        { emit: (event) => events.push(event) },
        {
          action: 'status_change',
          actorId,
          accountId,
          value: `"account-${accountId}-7"`,
        },
      ),
    ).toBe(7)
    expect(events).toEqual([])
  })
})
