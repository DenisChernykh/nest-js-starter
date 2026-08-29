import { Inject, Injectable } from '@nestjs/common'

import type {
  AccountActorAuthorization,
  AccountAdministrationState,
  AdminAccount,
} from './account-administration.port'
import {
  ACCOUNT_ADMINISTRATION_MUTATION,
  type AccountAdministrationMutationPort,
} from './account-administration-mutation.port'
import {
  ACCOUNT_ADMINISTRATION_READ,
  type AccountAdministrationReadPort,
} from './account-administration-read.port'
import { AuthDependencyUnavailableError, AuthError } from './auth-errors'
import {
  AUTH_ACCOUNTS_MANAGE_PERMISSION,
  AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
  RoleRegistry,
  type RoleDefinition,
} from './role-registry'
import type { PermissionKey } from '@/shared/application/permission'
import type { AuthSessionCleanupObserver } from './auth.types'
import type { SessionStorePort } from './session-store.port'
import {
  AUTH_AUDIT,
  NOOP_AUTH_AUDIT,
  type AuthAuditAction,
  type AuthAuditPort,
} from './auth-audit.port'

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

export interface AccountAdministrationPolicyConfig {
  readonly mode: 'disabled' | 'enabled'
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

@Injectable()
export class AccountAdministrationService {
  public constructor(
    @Inject(ACCOUNT_ADMINISTRATION_READ)
    private readonly queries: AccountAdministrationReadPort,
    @Inject(ACCOUNT_ADMINISTRATION_MUTATION)
    private readonly mutations: AccountAdministrationMutationPort,
    private readonly config: AccountAdministrationPolicyConfig,
    private readonly roles?: RoleRegistry,
    private readonly sessions?: SessionStorePort,
    private readonly cleanupObserver?: AuthSessionCleanupObserver,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort = NOOP_AUTH_AUDIT,
  ) {}

  public async listAccounts(input: {
    readonly page: number
    readonly pageSize: number
    readonly search?: string
    readonly state?: AccountAdministrationState
  }): Promise<{
    readonly items: readonly AdminAccount[]
    readonly total: number
  }> {
    this.assertEnabled()
    return this.queries.listAccounts(input)
  }

  public async getAccount(
    accountId: string,
  ): Promise<AdminAccount | undefined> {
    this.assertEnabled()
    return this.queries.getAccount(accountId)
  }

  public async changeStatus(input: {
    readonly actorId: string
    readonly accountId: string
    readonly status: 'active' | 'disabled'
    readonly expectedRevision: number
  }): Promise<AdminAccount | undefined> {
    return this.auditedMutation(
      'status_change',
      input.actorId,
      input.accountId,
      async () => {
        this.assertMutationTarget(input.actorId, input.accountId)
        const account = await this.mutations.changeStatus({
          ...input,
          actorAuthorization: this.actorAuthorization(
            AUTH_ACCOUNTS_MANAGE_PERMISSION,
          ),
        })
        if (account === undefined) {
          this.auditMissing('status_change', input.actorId, input.accountId)
          return undefined
        }
        const cleanupComplete =
          input.status !== 'disabled' ||
          (await this.cleanupSessions('account-disable', input.accountId))
        this.audit.emit({
          action: 'status_change',
          outcome: cleanupComplete ? 'success' : 'partial',
          reasonCode: cleanupComplete ? 'STATUS_CHANGED' : 'CLEANUP_INCOMPLETE',
          actorId: input.actorId,
          targetType: 'user',
          targetId: input.accountId,
        })
        return account
      },
    )
  }

  public async replaceRoles(input: {
    readonly actorId: string
    readonly accountId: string
    readonly roleKeys: readonly string[]
    readonly expectedRevision: number
  }): Promise<AdminAccount | undefined> {
    return this.auditedMutation(
      'role_change',
      input.actorId,
      input.accountId,
      async () => {
        this.assertMutationTarget(input.actorId, input.accountId)
        if (
          this.roles !== undefined &&
          input.roleKeys.some((key) => !this.roles?.hasRole(key))
        )
          throw new AccountRoleUnknownError()
        const account = await this.mutations.replaceRoles({
          ...input,
          actorAuthorization: this.actorAuthorization(
            AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
          ),
        })
        if (account === undefined) {
          this.auditMissing('role_change', input.actorId, input.accountId)
          return undefined
        }
        this.audit.emit({
          action: 'role_change',
          outcome: 'success',
          reasonCode: 'ROLE_CHANGED',
          actorId: input.actorId,
          targetType: 'user',
          targetId: input.accountId,
        })
        return account
      },
    )
  }

  public async retireAccount(input: {
    readonly actorId: string
    readonly accountId: string
    readonly expectedRevision: number
  }): Promise<boolean> {
    return this.auditedMutation(
      'account_retire',
      input.actorId,
      input.accountId,
      async () => {
        this.assertMutationTarget(input.actorId, input.accountId)
        const retired = await this.mutations.retireAccount({
          ...input,
          actorAuthorization: this.actorAuthorization(
            AUTH_ACCOUNTS_MANAGE_PERMISSION,
          ),
        })
        if (!retired) {
          this.auditMissing('account_retire', input.actorId, input.accountId)
          return false
        }
        const cleanupComplete = await this.cleanupSessions(
          'account-retire',
          input.accountId,
        )
        this.audit.emit({
          action: 'account_retire',
          outcome: cleanupComplete ? 'success' : 'partial',
          reasonCode: cleanupComplete
            ? 'ACCOUNT_RETIRED'
            : 'CLEANUP_INCOMPLETE',
          actorId: input.actorId,
          targetType: 'user',
          targetId: input.accountId,
        })
        return true
      },
    )
  }

  public async revokeAllSessions(input: {
    readonly actorId: string
    readonly accountId: string
  }): Promise<boolean> {
    return this.auditedMutation(
      'logout_all',
      input.actorId,
      input.accountId,
      async () => {
        this.assertMutationTarget(input.actorId, input.accountId)
        const revoked = await this.mutations.revokeAllSessions({
          ...input,
          actorAuthorization: this.actorAuthorization(
            AUTH_ACCOUNTS_MANAGE_PERMISSION,
          ),
        })
        if (!revoked) {
          this.auditMissing('logout_all', input.actorId, input.accountId)
          return false
        }
        const cleanupComplete = await this.cleanupSessions(
          'admin-logout-all',
          input.accountId,
        )
        this.audit.emit({
          action: 'logout_all',
          outcome: cleanupComplete ? 'success' : 'partial',
          reasonCode: cleanupComplete
            ? 'LOGOUT_ALL_COMPLETED'
            : 'CLEANUP_INCOMPLETE',
          actorId: input.actorId,
          targetType: 'user',
          targetId: input.accountId,
        })
        return true
      },
    )
  }

  public listRoles(): readonly RoleDefinition[] {
    this.assertEnabled()
    return this.roles?.listRoles() ?? []
  }

  private assertEnabled(): void {
    if (this.config.mode !== 'enabled') {
      throw new AccountAdministrationDisabledError()
    }
  }

  private assertMutationTarget(actorId: string, accountId: string): void {
    this.assertEnabled()
    if (actorId.toLowerCase() === accountId.toLowerCase())
      throw new AccountSelfMutationForbiddenError()
  }

  private async cleanupSessions(
    operation: 'account-disable' | 'account-retire' | 'admin-logout-all',
    accountId: string,
  ): Promise<boolean> {
    if (this.sessions === undefined) return true
    try {
      await this.sessions.revokeAll(accountId)
      return true
    } catch {
      this.cleanupObserver?.cleanupIncomplete(operation, accountId)
      return false
    }
  }

  private async auditedMutation<T>(
    action: Extract<
      AuthAuditAction,
      'status_change' | 'role_change' | 'account_retire' | 'logout_all'
    >,
    actorId: string,
    targetId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation()
    } catch (error: unknown) {
      const normalized =
        error instanceof AuthError
          ? error
          : new AuthDependencyUnavailableError()
      const result =
        normalized instanceof AccountRoleUnknownError
          ? { outcome: 'denied' as const, reasonCode: 'UNKNOWN_ROLE' }
          : normalized.code === 'AUTHORIZATION_DENIED'
            ? {
                outcome: 'denied' as const,
                reasonCode: 'AUTHORIZATION_DENIED',
              }
            : normalized.code === 'AUTH_STATE_CONFLICT'
              ? { outcome: 'conflict' as const, reasonCode: 'STATE_CONFLICT' }
              : normalized.code === 'AUTH_DEPENDENCY_UNAVAILABLE'
                ? {
                    outcome: 'denied' as const,
                    reasonCode: 'DEPENDENCY_UNAVAILABLE',
                  }
                : undefined
      if (result !== undefined)
        this.audit.emit({
          action,
          ...result,
          actorId,
          targetType: 'user',
          targetId,
        })
      throw normalized
    }
  }

  private auditMissing(
    action: Extract<
      AuthAuditAction,
      'status_change' | 'role_change' | 'account_retire' | 'logout_all'
    >,
    actorId: string,
    targetId: string,
  ): void {
    this.audit.emit({
      action,
      outcome: 'denied',
      reasonCode: 'ACCOUNT_NOT_FOUND',
      actorId,
      targetType: 'user',
      targetId,
    })
  }

  private actorAuthorization(
    ...permissions: readonly PermissionKey[]
  ): AccountActorAuthorization {
    const roles = this.roles
    if (roles === undefined) throw new AuthDependencyUnavailableError()
    return {
      requiredRoleGroups: permissions.map((permission) =>
        roles.roleKeysGranting(permission),
      ),
    }
  }
}
