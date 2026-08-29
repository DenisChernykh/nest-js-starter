import { Inject, Injectable } from '@nestjs/common'

import {
  ACCOUNT_ADMINISTRATION_MUTATION,
  type AccountAdministrationMutationPort,
} from './account-administration-mutation.port'
import {
  AccountAdministrationDisabledError,
  AccountRoleUnknownError,
  AccountSelfMutationForbiddenError,
} from './account-administration.errors'
import type { AdminAccount } from './account-administration.model'
import {
  ACCOUNT_ADMINISTRATION_POLICY,
  type AccountAdministrationPolicy,
} from './account-administration.policy'
import type { AccountActorAuthorization } from '../../authorization/application/account-actor-authorization'
import {
  AUTH_ACCOUNTS_MANAGE_PERMISSION,
  AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
  RoleRegistry,
} from '../../authorization/application/role-registry'
import { SessionCleanupService } from '../../sessions/application/session-cleanup.service'
import {
  AUTH_AUDIT,
  type AuthAuditAction,
  type AuthAuditPort,
} from '../../public-contracts/auth-audit.port'
import {
  AuthDependencyUnavailableError,
  AuthError,
} from '../../public-contracts/auth-errors'
import { canonicalizeUserId } from '../../public-contracts/canonical-user-id'
import type { PermissionKey } from '@/shared/application/permission'

@Injectable()
export class AccountAdministrationMutations {
  public constructor(
    @Inject(ACCOUNT_ADMINISTRATION_MUTATION)
    private readonly accounts: AccountAdministrationMutationPort,
    @Inject(ACCOUNT_ADMINISTRATION_POLICY)
    private readonly policy: AccountAdministrationPolicy,
    @Inject(RoleRegistry)
    private readonly roles: RoleRegistry,
    @Inject(SessionCleanupService)
    private readonly sessionCleanup: SessionCleanupService,
    @Inject(AUTH_AUDIT)
    private readonly audit: AuthAuditPort,
  ) {}

  public async changeStatus(input: {
    readonly actorId: string
    readonly accountId: string
    readonly status: 'active' | 'disabled'
    readonly expectedRevision: number
  }): Promise<AdminAccount | undefined> {
    const actorId = canonicalizeUserId(input.actorId)
    const accountId = canonicalizeUserId(input.accountId)
    return this.auditedMutation(
      'status_change',
      actorId,
      accountId,
      async () => {
        this.assertMutationTarget(actorId, accountId)
        const account = await this.accounts.changeStatus({
          ...input,
          actorId,
          accountId,
          actorAuthorization: this.actorAuthorization(
            AUTH_ACCOUNTS_MANAGE_PERMISSION,
          ),
        })
        if (account === undefined) {
          this.auditMissing('status_change', actorId, accountId)
          return undefined
        }
        const cleanupComplete =
          input.status !== 'disabled' ||
          (await this.sessionCleanup.cleanupAfterDurableInvalidation(
            'account-disable',
            accountId,
          ))
        this.audit.emit({
          action: 'status_change',
          outcome: cleanupComplete ? 'success' : 'partial',
          reasonCode: cleanupComplete ? 'STATUS_CHANGED' : 'CLEANUP_INCOMPLETE',
          actorId,
          targetType: 'user',
          targetId: accountId,
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
    const actorId = canonicalizeUserId(input.actorId)
    const accountId = canonicalizeUserId(input.accountId)
    return this.auditedMutation('role_change', actorId, accountId, async () => {
      this.assertMutationTarget(actorId, accountId)
      if (input.roleKeys.some((key) => !this.roles.hasRole(key)))
        throw new AccountRoleUnknownError()
      const account = await this.accounts.replaceRoles({
        ...input,
        actorId,
        accountId,
        actorAuthorization: this.actorAuthorization(
          AUTH_ACCOUNTS_ROLES_MANAGE_PERMISSION,
        ),
      })
      if (account === undefined) {
        this.auditMissing('role_change', actorId, accountId)
        return undefined
      }
      this.audit.emit({
        action: 'role_change',
        outcome: 'success',
        reasonCode: 'ROLE_CHANGED',
        actorId,
        targetType: 'user',
        targetId: accountId,
      })
      return account
    })
  }

  public async retireAccount(input: {
    readonly actorId: string
    readonly accountId: string
    readonly expectedRevision: number
  }): Promise<boolean> {
    const actorId = canonicalizeUserId(input.actorId)
    const accountId = canonicalizeUserId(input.accountId)
    return this.auditedMutation(
      'account_retire',
      actorId,
      accountId,
      async () => {
        this.assertMutationTarget(actorId, accountId)
        const retired = await this.accounts.retireAccount({
          ...input,
          actorId,
          accountId,
          actorAuthorization: this.actorAuthorization(
            AUTH_ACCOUNTS_MANAGE_PERMISSION,
          ),
        })
        if (!retired) {
          this.auditMissing('account_retire', actorId, accountId)
          return false
        }
        const cleanupComplete =
          await this.sessionCleanup.cleanupAfterDurableInvalidation(
            'account-retire',
            accountId,
          )
        this.audit.emit({
          action: 'account_retire',
          outcome: cleanupComplete ? 'success' : 'partial',
          reasonCode: cleanupComplete
            ? 'ACCOUNT_RETIRED'
            : 'CLEANUP_INCOMPLETE',
          actorId,
          targetType: 'user',
          targetId: accountId,
        })
        return true
      },
    )
  }

  public async revokeAllSessions(input: {
    readonly actorId: string
    readonly accountId: string
  }): Promise<boolean> {
    const actorId = canonicalizeUserId(input.actorId)
    const accountId = canonicalizeUserId(input.accountId)
    return this.auditedMutation('logout_all', actorId, accountId, async () => {
      this.assertMutationTarget(actorId, accountId)
      const revoked = await this.accounts.revokeAllSessions({
        ...input,
        actorId,
        accountId,
        actorAuthorization: this.actorAuthorization(
          AUTH_ACCOUNTS_MANAGE_PERMISSION,
        ),
      })
      if (!revoked) {
        this.auditMissing('logout_all', actorId, accountId)
        return false
      }
      const cleanupComplete =
        await this.sessionCleanup.cleanupAfterDurableInvalidation(
          'admin-logout-all',
          accountId,
        )
      this.audit.emit({
        action: 'logout_all',
        outcome: cleanupComplete ? 'success' : 'partial',
        reasonCode: cleanupComplete
          ? 'LOGOUT_ALL_COMPLETED'
          : 'CLEANUP_INCOMPLETE',
        actorId,
        targetType: 'user',
        targetId: accountId,
      })
      return true
    })
  }

  private assertEnabled(): void {
    if (this.policy.mode !== 'enabled')
      throw new AccountAdministrationDisabledError()
  }

  private assertMutationTarget(actorId: string, accountId: string): void {
    this.assertEnabled()
    if (actorId.toLowerCase() === accountId.toLowerCase())
      throw new AccountSelfMutationForbiddenError()
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
    return {
      requiredRoleGroups: permissions.map((permission) =>
        this.roles.roleKeysGranting(permission),
      ),
    }
  }
}
