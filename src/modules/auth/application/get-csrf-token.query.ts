import { Inject, Injectable } from '@nestjs/common'

import { AuthenticationRequiredError } from './auth-errors'
import { SESSION_STORE, type SessionStorePort } from './session-store.port'

/** Session-bound anti-CSRF value returned only for a valid opaque token. */
export interface CsrfTokenView {
  readonly csrfToken: string
}

/** Revalidates a session and derives its CSRF token with the dedicated key. */
@Injectable()
export class GetCsrfTokenQuery {
  public constructor(
    @Inject(SESSION_STORE) private readonly sessions: SessionStorePort,
  ) {}

  public async execute(
    rawToken: string,
    nowMs: number,
  ): Promise<CsrfTokenView> {
    const record = await this.sessions.readAndTouch(rawToken, nowMs)
    if (record === undefined) throw new AuthenticationRequiredError()
    return Object.freeze({ csrfToken: this.sessions.csrfToken(record) })
  }
}
