import type { AuthAuditPort } from '../../application/auth-audit.port'
import {
  AuthDependencyUnavailableError,
  AuthenticationRequiredError,
} from '../../application/auth-errors'
import type { AuthenticateSessionUseCase } from '../application/authenticate-session.use-case'
import {
  definePermissions,
  type PermissionKey,
} from '../application/permission'
import { readCanonicalSessionToken } from '../../sessions'
import type {
  DocsAccessDecision,
  DocsAccessProblemCode,
  DocsAccessPolicy,
} from '@/platform/http/docs/docs-access.contracts'

function createDocsReadPermission(): PermissionKey {
  const permission = definePermissions(['system.docs.read'])[0]
  if (permission === undefined) {
    throw new Error('Docs permission definition is empty')
  }
  return permission
}
const docsReadPermission = createDocsReadPermission()

/** Auth presentation adapter for fresh session and permission-based docs access. */
export class DocsAccessPolicyAdapter implements DocsAccessPolicy {
  public constructor(
    private readonly authenticate: AuthenticateSessionUseCase,
    private readonly audit: AuthAuditPort,
    private readonly cookieName: string,
  ) {}

  /** Resolves one finite decision without returning a raw token or auth error. */
  public async authorize(
    cookieHeader: string | undefined,
    nowMs: number,
  ): Promise<DocsAccessDecision> {
    const token = readCanonicalSessionToken(cookieHeader, this.cookieName)
    if (token === undefined) {
      return this.deny('AUTHENTICATION_REQUIRED')
    }

    try {
      const principal = await this.authenticate.execute(token, nowMs)
      if (!principal.permissions.has(docsReadPermission)) {
        return this.deny('AUTHORIZATION_DENIED', {
          actorId: principal.userId,
          sessionId: principal.sessionId,
        })
      }
      return { allowed: true }
    } catch (error: unknown) {
      if (error instanceof AuthenticationRequiredError) {
        return this.deny('AUTHENTICATION_REQUIRED')
      }
      if (error instanceof AuthDependencyUnavailableError) {
        return this.deny('DEPENDENCY_UNAVAILABLE')
      }
      return this.deny('DEPENDENCY_UNAVAILABLE')
    }
  }

  private deny(
    problemCode: DocsAccessProblemCode,
    identity?: { readonly actorId: string; readonly sessionId: string },
  ): DocsAccessDecision {
    this.audit.emit({
      action: 'docs_access',
      outcome: 'denied',
      reasonCode: problemCode,
      ...identity,
    })
    return { allowed: false, problemCode }
  }
}
