import {
  AccountEmailAlreadyExistsError,
  AccountEmailWorkflowTargetUnavailableError,
  AccountLifecycleRoleUnknownError,
} from './account-lifecycle-errors'
import type { AccountMailDeliveryResult } from './account-mail-delivery.result'
import { AuthTokenInvalidOrExpiredError } from './self-service-auth.policy'
import {
  AuthDependencyUnavailableError,
  AuthError,
  AuthRateLimitedError,
} from '../../public-contracts/auth-errors'
import type {
  AuthAuditAction,
  AuthAuditPort,
} from '../../public-contracts/auth-audit.port'
import type { AccountActorAuthorization } from '../../authorization/application/account-actor-authorization'
import type { RoleRegistry } from '../../authorization/application/role-registry'
import type { PermissionKey } from '@/shared/application/permission'

export type AccountLifecycleWorkflowAction = Extract<
  AuthAuditAction,
  | 'account_invitation_create'
  | 'account_invitation_resend'
  | 'admin_password_reset_request'
  | 'account_invitation_accept'
>

export async function persistAccountLifecycleOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof AuthError) throw error
    throw new AuthDependencyUnavailableError()
  }
}

export function accountActorAuthorization(
  roles: RoleRegistry,
  ...permissions: readonly PermissionKey[]
): AccountActorAuthorization {
  return {
    requiredRoleGroups: permissions.map((permission) =>
      roles.roleKeysGranting(permission),
    ),
  }
}

export function auditAccountLifecycleMailResult(
  audit: AuthAuditPort,
  action: Exclude<AccountLifecycleWorkflowAction, 'account_invitation_accept'>,
  actorId: string,
  targetId: string,
  result: AccountMailDeliveryResult,
): void {
  audit.emit({
    action,
    outcome: result.mailDelivery === 'delivered' ? 'success' : 'partial',
    reasonCode:
      result.mailDelivery === 'delivered'
        ? 'MAIL_DELIVERED'
        : 'MAIL_DELIVERY_FAILED',
    actorId,
    targetType: 'user',
    targetId,
  })
}

export async function runAuditedAccountLifecycleWorkflow<T>(input: {
  readonly audit: AuthAuditPort
  readonly action: AccountLifecycleWorkflowAction
  readonly actorId?: string
  readonly targetId?: string
  readonly operation: () => Promise<T>
}): Promise<T> {
  try {
    return await input.operation()
  } catch (error: unknown) {
    const normalized =
      error instanceof AuthError ? error : new AuthDependencyUnavailableError()
    const result = classifyAccountLifecycleFailure(normalized)
    if (result !== undefined)
      input.audit.emit({
        action: input.action,
        ...result,
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
        ...(input.targetId === undefined
          ? {}
          : { targetType: 'user' as const, targetId: input.targetId }),
      })
    throw normalized
  }
}

function classifyAccountLifecycleFailure(
  error: AuthError,
):
  | { readonly outcome: 'denied' | 'conflict'; readonly reasonCode: string }
  | undefined {
  if (error instanceof AccountLifecycleRoleUnknownError)
    return { outcome: 'denied', reasonCode: 'UNKNOWN_ROLE' }
  if (error instanceof AccountEmailAlreadyExistsError)
    return { outcome: 'conflict', reasonCode: 'EMAIL_ALREADY_EXISTS' }
  if (error instanceof AccountEmailWorkflowTargetUnavailableError)
    return { outcome: 'conflict', reasonCode: 'STATE_CONFLICT' }
  if (error instanceof AuthTokenInvalidOrExpiredError)
    return { outcome: 'denied', reasonCode: 'TOKEN_INVALID_OR_EXPIRED' }
  if (error instanceof AuthRateLimitedError)
    return { outcome: 'denied', reasonCode: 'RATE_LIMITED' }
  if (error.code === 'AUTHORIZATION_DENIED')
    return { outcome: 'denied', reasonCode: 'AUTHORIZATION_DENIED' }
  if (error.code === 'AUTH_DEPENDENCY_UNAVAILABLE')
    return { outcome: 'denied', reasonCode: 'DEPENDENCY_UNAVAILABLE' }
  return undefined
}
