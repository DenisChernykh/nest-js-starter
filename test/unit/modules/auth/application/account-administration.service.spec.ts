import {
  AccountAdministrationDisabledError,
  AccountAdministrationService,
  AccountEtagMalformedError,
  AccountEtagPreconditionFailedError,
  AccountEtagPreconditionRequiredError,
  AccountSelfMutationForbiddenError,
} from '@/modules/auth/application/account-administration.service'
import type { AccountAdministrationPort } from '@/modules/auth/application/account-administration.port'
import type { SessionStorePort } from '@/modules/auth/application/session-store.port'
import type { AuthAuditEvent } from '@/modules/auth/application/auth-audit.port'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'
import type { StructuredLogRecord } from '@/platform/logging/logging.contracts'
import {
  AUTH_ACCOUNTS_MANAGE_PERMISSION,
  AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
  RoleRegistry,
} from '@/modules/auth/application/role-registry'

const roles = new RoleRegistry([
  {
    key: 'system.admin',
    permissions: [
      AUTH_ACCOUNTS_MANAGE_PERMISSION,
      AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
    ],
  },
])

describe('AccountAdministrationService', () => {
  it('rejects a status mutation for the acting account before persistence', async () => {
    const changeStatus = jest.fn()
    const persistence = {
      changeStatus,
    } as unknown as AccountAdministrationPort
    const service = new AccountAdministrationService(
      persistence,
      {
        mode: 'enabled',
      },
      roles,
    )

    await expect(
      service.changeStatus({
        actorId: 'user-1',
        accountId: 'user-1',
        status: 'disabled',
        ifMatch: '"account-user-1-0"',
      }),
    ).rejects.toBeInstanceOf(AccountSelfMutationForbiddenError)
    expect(changeStatus).not.toHaveBeenCalled()
  })

  it('rejects self-mutation when the UUID path uses uppercase hex', async () => {
    const changeStatus = jest.fn()
    const persistence = {
      changeStatus,
    } as unknown as AccountAdministrationPort
    const service = new AccountAdministrationService(
      persistence,
      { mode: 'enabled' },
      roles,
    )
    const actorId = '95ee8d48-2f19-49be-af21-c5f471c1e502'
    const accountId = actorId.toUpperCase()

    await expect(
      service.changeStatus({
        actorId,
        accountId,
        status: 'disabled',
        ifMatch: `"account-${accountId}-0"`,
      }),
    ).rejects.toBeInstanceOf(AccountSelfMutationForbiddenError)
    expect(changeStatus).not.toHaveBeenCalled()
  })

  it('keeps the entire capability unavailable while disabled', async () => {
    const listAccounts = jest.fn()
    const persistence = {
      listAccounts,
    } as unknown as AccountAdministrationPort
    const service = new AccountAdministrationService(persistence, {
      mode: 'disabled',
    })

    await expect(
      service.listAccounts({ page: 1, pageSize: 50 }),
    ).rejects.toBeInstanceOf(AccountAdministrationDisabledError)
    expect(listAccounts).not.toHaveBeenCalled()
  })

  it('parses only the current account strong ETag before a mutation', async () => {
    const changeStatus = jest.fn().mockResolvedValue(undefined)
    const persistence = {
      changeStatus,
    } as unknown as AccountAdministrationPort
    const service = new AccountAdministrationService(
      persistence,
      { mode: 'enabled' },
      roles,
    )
    const accountId = '95ee8d48-2f19-49be-af21-c5f471c1e502'

    await service.changeStatus({
      actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
      accountId,
      status: 'disabled',
      ifMatch: `"account-${accountId}-7"`,
    })

    expect(changeStatus).toHaveBeenCalledWith({
      actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
      accountId,
      status: 'disabled',
      ifMatch: `"account-${accountId}-7"`,
      expectedRevision: 7,
      actorAuthorization: {
        requiredRoleGroups: [['system.admin']],
      },
    })
  })

  it('rejects missing and malformed ETags before persistence', async () => {
    const changeStatus = jest.fn()
    const persistence = {
      changeStatus,
    } as unknown as AccountAdministrationPort
    const service = new AccountAdministrationService(persistence, {
      mode: 'enabled',
    })
    const input = {
      actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
      accountId: '95ee8d48-2f19-49be-af21-c5f471c1e502',
      status: 'disabled' as const,
    }

    await expect(
      service.changeStatus({ ...input, ifMatch: undefined }),
    ).rejects.toBeInstanceOf(AccountEtagPreconditionRequiredError)
    await expect(
      service.changeStatus({ ...input, ifMatch: 'W/"anything"' }),
    ).rejects.toBeInstanceOf(AccountEtagMalformedError)
    expect(changeStatus).not.toHaveBeenCalled()
  })

  it('cleans Redis sessions after a durable disable', async () => {
    const accountId = '95ee8d48-2f19-49be-af21-c5f471c1e502'
    const account = {
      id: accountId,
      email: 'target@example.com',
      state: 'disabled' as const,
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      roleKeys: [],
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-07T00:00:00.000Z'),
      retiredAt: null,
      revision: 1,
    }
    const revokeAll = jest.fn(() => Promise.resolve(2))
    const service = new AccountAdministrationService(
      {
        changeStatus: () => Promise.resolve(account),
      } as unknown as AccountAdministrationPort,
      { mode: 'enabled' },
      roles,
      { revokeAll } as unknown as SessionStorePort,
    )

    await expect(
      service.changeStatus({
        actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
        accountId,
        status: 'disabled',
        ifMatch: `"account-${accountId}-0"`,
      }),
    ).resolves.toEqual(account)
    expect(revokeAll).toHaveBeenCalledWith(accountId)
  })

  it('audits successful privileged account mutations without account values', async () => {
    const accountId = '95ee8d48-2f19-49be-af21-c5f471c1e502'
    const actorId = '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123'
    const account = {
      id: accountId,
      email: 'target@example.com',
      state: 'disabled' as const,
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      roleKeys: [],
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-07T00:00:00.000Z'),
      retiredAt: null,
      revision: 1,
    }
    const writes: StructuredLogRecord[] = []
    const sink = {
      write: (record: StructuredLogRecord): void => {
        writes.push(record)
      },
    }
    const audit = new AuthAuditLogger(sink)
    const service = new AccountAdministrationService(
      {
        changeStatus: () => Promise.resolve(account),
        replaceRoles: () => Promise.resolve(account),
        retireAccount: () => Promise.resolve(true),
        revokeAllSessions: () => Promise.resolve(true),
      } as unknown as AccountAdministrationPort,
      { mode: 'enabled' },
      roles,
      undefined,
      undefined,
      audit,
    )

    await service.changeStatus({
      actorId,
      accountId,
      status: 'disabled',
      ifMatch: `"account-${accountId}-0"`,
    })
    await service.replaceRoles({
      actorId,
      accountId,
      roleKeys: [],
      ifMatch: `"account-${accountId}-1"`,
    })
    await service.retireAccount({
      actorId,
      accountId,
      ifMatch: `"account-${accountId}-2"`,
    })
    await service.revokeAllSessions({ actorId, accountId })

    expect(writes.map((entry) => entry.attributes)).toEqual([
      {
        kind: 'audit',
        action: 'status_change',
        outcome: 'success',
        reasonCode: 'STATUS_CHANGED',
        actorId,
        targetType: 'user',
        targetId: accountId,
      },
      {
        kind: 'audit',
        action: 'role_change',
        outcome: 'success',
        reasonCode: 'ROLE_CHANGED',
        actorId,
        targetType: 'user',
        targetId: accountId,
      },
      {
        kind: 'audit',
        action: 'account_retire',
        outcome: 'success',
        reasonCode: 'ACCOUNT_RETIRED',
        actorId,
        targetType: 'user',
        targetId: accountId,
      },
      {
        kind: 'audit',
        action: 'logout_all',
        outcome: 'success',
        reasonCode: 'LOGOUT_ALL_COMPLETED',
        actorId,
        targetType: 'user',
        targetId: accountId,
      },
    ])
    expect(audit.getFailureCount()).toBe(0)
  })

  it('audits a stale administrative mutation as a conflict', async () => {
    const accountId = '95ee8d48-2f19-49be-af21-c5f471c1e502'
    const actorId = '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123'
    const events: AuthAuditEvent[] = []
    const service = new AccountAdministrationService(
      {
        changeStatus: () =>
          Promise.reject(new AccountEtagPreconditionFailedError()),
      } as unknown as AccountAdministrationPort,
      { mode: 'enabled' },
      roles,
      undefined,
      undefined,
      { emit: (event) => events.push(event) },
    )

    await expect(
      service.changeStatus({
        actorId,
        accountId,
        status: 'disabled',
        ifMatch: `"account-${accountId}-0"`,
      }),
    ).rejects.toBeInstanceOf(AccountEtagPreconditionFailedError)
    expect(events).toEqual([
      {
        action: 'status_change',
        outcome: 'conflict',
        reasonCode: 'STATE_CONFLICT',
        actorId,
        targetType: 'user',
        targetId: accountId,
      },
    ])
  })

  it('keeps durable logout-all successful when Redis cleanup fails', async () => {
    const accountId = '95ee8d48-2f19-49be-af21-c5f471c1e502'
    const cleanupIncomplete = jest.fn()
    const events: AuthAuditEvent[] = []
    const service = new AccountAdministrationService(
      {
        revokeAllSessions: () => Promise.resolve(true),
      } as unknown as AccountAdministrationPort,
      { mode: 'enabled' },
      roles,
      {
        revokeAll: () => Promise.reject(new Error('redis unavailable')),
      } as unknown as SessionStorePort,
      { cleanupIncomplete },
      { emit: (event) => events.push(event) },
    )

    await expect(
      service.revokeAllSessions({
        actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
        accountId,
      }),
    ).resolves.toBe(true)
    expect(cleanupIncomplete).toHaveBeenCalledWith(
      'admin-logout-all',
      accountId,
    )
    expect(events).toEqual([
      expect.objectContaining({
        action: 'logout_all',
        outcome: 'partial',
        reasonCode: 'CLEANUP_INCOMPLETE',
      }),
    ])
  })
})
