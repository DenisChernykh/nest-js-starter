import { timingSafeEqual } from 'node:crypto'

import { Injectable, SetMetadata } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AuthCsrfRejectedError } from '../application/auth-errors'
import type { GetCsrfTokenQuery } from '../application/get-csrf-token.query'
import type { AuthRequestContext } from './auth-request.context'

/** Metadata key for the login endpoint's CSRF-token-only exemption. */
export const CSRF_TOKEN_EXEMPT_METADATA = Symbol('auth:csrf-token-exempt')

/** Exempts one endpoint from the session-bound token check only. */
export function CsrfTokenExempt(): MethodDecorator {
  return SetMetadata(CSRF_TOKEN_EXEMPT_METADATA, true)
}

/** Constant-time comparator contract for two canonical CSRF token values. */
export type CsrfTokenComparator = (
  provided: string,
  expected: string,
) => boolean

function canonicalBytes(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return undefined
  const bytes = Buffer.from(value, 'base64url')
  return bytes.length === 32 && bytes.toString('base64url') === value
    ? bytes
    : undefined
}

function constantTimeTokenEqual(provided: string, expected: string): boolean {
  const providedBytes = canonicalBytes(provided)
  const expectedBytes = canonicalBytes(expected)
  const fallback = Buffer.alloc(32)
  const equal = timingSafeEqual(
    providedBytes ?? fallback,
    expectedBytes ?? fallback,
  )
  return providedBytes !== undefined && expectedBytes !== undefined && equal
}

interface CsrfRequest {
  readonly method: string
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Revalidates and compares the session-bound token for unsafe requests. */
@Injectable()
export class SessionCsrfGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: AuthRequestContext,
    private readonly csrf: GetCsrfTokenQuery,
    private readonly compare: CsrfTokenComparator = constantTimeTokenEqual,
    private readonly now: () => number = Date.now,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CsrfRequest>()
    if (safeMethods.has(request.method.toUpperCase())) return true
    const isExempt = this.reflector.getAllAndOverride<boolean>(
      CSRF_TOKEN_EXEMPT_METADATA,
      [context.getHandler(), context.getClass()],
    )
    if (isExempt === true) return true
    const provided = request.headers['x-csrf-token']
    if (typeof provided !== 'string') throw new AuthCsrfRejectedError()
    const { rawToken } = this.requestContext.preparedState(request)
    const { csrfToken } = await this.csrf.execute(rawToken, this.now())
    if (!this.compare(provided, csrfToken)) throw new AuthCsrfRejectedError()
    return true
  }
}
