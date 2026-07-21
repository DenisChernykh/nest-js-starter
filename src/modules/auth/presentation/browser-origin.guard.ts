import { Injectable } from '@nestjs/common'
import type { CanActivate, ExecutionContext } from '@nestjs/common'

import { AuthCsrfRejectedError } from '../application/auth-errors'

interface BrowserRequest {
  readonly method: string
  readonly headers: Readonly<
    Record<string, string | readonly string[] | undefined>
  >
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

function oneHeader(
  headers: BrowserRequest['headers'],
  name: string,
): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (referer === undefined) return undefined
  try {
    return new URL(referer).origin
  } catch {
    return undefined
  }
}

/** Enforces exact trusted browser origin and JSON-only unsafe requests. */
@Injectable()
export class BrowserOriginGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>

  public constructor(allowedOrigins: readonly string[]) {
    this.allowedOrigins = new Set(allowedOrigins)
  }

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<BrowserRequest>()
    if (safeMethods.has(request.method.toUpperCase())) return true
    const fetchSite = oneHeader(request.headers, 'sec-fetch-site')
    const contentType = oneHeader(request.headers, 'content-type')
    const origin =
      oneHeader(request.headers, 'origin') ??
      refererOrigin(oneHeader(request.headers, 'referer'))
    if (
      fetchSite === 'cross-site' ||
      contentType?.split(';', 1)[0]?.trim().toLowerCase() !==
        'application/json' ||
      origin === undefined ||
      !this.allowedOrigins.has(origin)
    ) {
      throw new AuthCsrfRejectedError()
    }
    return true
  }
}
