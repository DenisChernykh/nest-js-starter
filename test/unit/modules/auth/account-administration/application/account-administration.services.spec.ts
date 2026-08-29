import {
  AccountAdministrationDisabledError,
  AccountRevisionConflictError,
  AccountSelfMutationForbiddenError,
} from '@/modules/auth/account-administration/application/account-administration.errors'
import { AccountAdministrationMutations } from '@/modules/auth/account-administration/application/account-administration-mutations.service'
import type { AccountAdministrationMutationPort } from '@/modules/auth/account-administration/application/account-administration-mutation.port'
import { AccountAdministrationQueries } from '@/modules/auth/account-administration/application/account-administration-queries.service'
import type { AccountAdministrationReadPort } from '@/modules/auth/account-administration/application/account-administration-read.port'
import type { SessionStorePort } from '@/modules/auth/sessions/application/session-store.port'
import { SessionCleanupService } from '@/modules/auth/sessions/application/session-cleanup.service'
import type { AuthAuditEvent } from '@/modules/auth/public-contracts/auth-audit.port'
import { AuthAuditLogger } from '@/platform/logging/auth-audit.logger'
import type { StructuredLogRecord } from '@/platform/logging/logging.contracts'
import {
  AUTH_ACCOUNTS_MANAGE_PERMISSION,
  AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
  RoleRegistry,
} from '@/modules/auth/authorization/application/role-registry'

const roles = new RoleRegistry([
  {
    key: 'system.admin',
    permissions: [
      AUTH_ACCOUNTS_MANAGE_PERMISSION,
      AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
    ],
  },
])

type AccountAdministrationPersistence = AccountAdministrationReadPort &
  AccountAdministrationMutationPort

const noopCleanup = new SessionCleanupService({
  revokeAll: () => Promise.resolve(0),
} as unknown as SessionStorePort)
const noopAudit = { emit: (): void => undefined }

describe('AccountAdministration queries and mutations', () => {
  it('rejects a status mutation for the acting account before persistence', async () => {
    const changeStatus = jest.fn()
    const persistence = {
      changeStatus,
    } as unknown as AccountAdministrationPersistence
    const service = new AccountAdministrationMutations(
      persistence,
      {
        mode: 'enabled',
      },
      roles,
      noopCleanup,
      noopAudit,
    )

    await expect(
      service.changeStatus({
        actorId: 'user-1',
        accountId: 'user-1',
        status: 'disabled',
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(AccountSelfMutationForbiddenError)
    expect(changeStatus).not.toHaveBeenCalled()
  })

  it('rejects self-mutation when the UUID path uses uppercase hex', async () => {
    const changeStatus = jest.fn()
    const persistence = {
      changeStatus,
    } as unknown as AccountAdministrationPersistence
    const service = new AccountAdministrationMutations(
      persistence,
      { mode: 'enabled' },
      roles,
      noopCleanup,
      noopAudit,
    )
    const actorId = '95ee8d48-2f19-49be-af21-c5f471c1e502'
    const accountId = actorId.toUpperCase()

    await expect(
      service.changeStatus({
        actorId,
        accountId,
        status: 'disabled',
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(AccountSelfMutationForbiddenError)
    expect(changeStatus).not.toHaveBeenCalled()
  })

  it('keeps the entire capability unavailable while disabled', async () => {
    const listAccounts = jest.fn()
    const persistence = {
      listAccounts,
    } as unknown as AccountAdministrationPersistence
    const service = new AccountAdministrationQueries(
      persistence,
      { mode: 'disabled' },
      roles,
    )

    await expect(
      service.listAccounts({ page: 1, pageSize: 50 }),
    ).rejects.toBeInstanceOf(AccountAdministrationDisabledError)
    expect(listAccounts).not.toHaveBeenCalled()
  })

  it('passes the transport-neutral expected revision to persistence', async () => {
    const changeStatus = jest.fn().mockResolvedValue(undefined)
    const persistence = {
      changeStatus,
    } as unknown as AccountAdministrationPersistence
    const service = new AccountAdministrationMutations(
      persistence,
      { mode: 'enabled' },
      roles,
      noopCleanup,
      noopAudit,
    )
    const accountId = '95ee8d48-2f19-49be-af21-c5f471c1e502'

    await service.changeStatus({
      actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
      accountId,
      status: 'disabled',
      expectedRevision: 7,
    })

    expect(changeStatus).toHaveBeenCalledWith({
      actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
      accountId,
      status: 'disabled',
      expectedRevision: 7,
      actorAuthorization: {
        requiredRoleGroups: [['system.admin']],
      },
    })
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
    const persistence = {
      changeStatus: () => Promise.resolve(account),
    } as unknown as AccountAdministrationPersistence
    const service = new AccountAdministrationMutations(
      persistence,
      { mode: 'enabled' },
      roles,
      new SessionCleanupService({ revokeAll } as unknown as SessionStorePort),
      noopAudit,
    )

    await expect(
      service.changeStatus({
        actorId: '2f54e3a8-a613-4a85-b0dc-08ea0c3cf123',
        accountId,
        status: 'disabled',
        expectedRevision: 0,
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
    const persistence = {
      changeStatus: () => Promise.resolve(account),
      replaceRoles: () => Promise.resolve(account),
      retireAccount: () => Promise.resolve(true),
      revokeAllSessions: () => Promise.resolve(true),
    } as unknown as AccountAdministrationPersistence
    const service = new AccountAdministrationMutations(
      persistence,
      { mode: 'enabled' },
      roles,
      noopCleanup,
      audit,
    )

    await service.changeStatus({
      actorId,
      accountId,
      status: 'disabled',
      expectedRevision: 0,
    })
    await service.replaceRoles({
      actorId,
      accountId,
      roleKeys: [],
      expectedRevision: 1,
    })
    await service.retireAccount({
      actorId,
      accountId,
      expectedRevision: 2,
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
    const persistence = {
      changeStatus: () => Promise.reject(new AccountRevisionConflictError()),
    } as unknown as AccountAdministrationPersistence
    const service = new AccountAdministrationMutations(
      persistence,
      { mode: 'enabled' },
      roles,
      noopCleanup,
      { emit: (event) => events.push(event) },
    )

    await expect(
      service.changeStatus({
        actorId,
        accountId,
        status: 'disabled',
        expectedRevision: 0,
      }),
    ).rejects.toBeInstanceOf(AccountRevisionConflictError)
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
    const persistence = {
      revokeAllSessions: () => Promise.resolve(true),
    } as unknown as AccountAdministrationPersistence
    const service = new AccountAdministrationMutations(
      persistence,
      { mode: 'enabled' },
      roles,
      new SessionCleanupService(
        {
          revokeAll: () => Promise.reject(new Error('redis unavailable')),
        } as unknown as SessionStorePort,
        { cleanupIncomplete },
      ),
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
