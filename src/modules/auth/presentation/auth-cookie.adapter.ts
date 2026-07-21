import { Injectable } from '@nestjs/common'
import type { Response } from 'express'

import type { IssuedBrowserSession } from '../application/session-store.port'

/** Sole owner of browser session cookie creation and deletion attributes. */
@Injectable()
export class AuthCookieAdapter {
  public constructor(
    private readonly cookieName: string,
    private readonly secure: boolean,
  ) {}

  /** Sets a host-only opaque session cookie until its absolute deadline. */
  public set(response: Response, session: IssuedBrowserSession): void {
    response.cookie(this.cookieName, session.rawToken, {
      expires: session.absoluteExpiresAt,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.secure,
    })
  }

  /** Clears the cookie with the same immutable transport attributes. */
  public clear(response: Response): void {
    response.clearCookie(this.cookieName, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.secure,
    })
  }
}
