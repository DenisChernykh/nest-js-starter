import { AuthenticationRequiredError } from './auth-errors'
import type { SessionStorePort } from './session-store.port'

/** Session-bound anti-CSRF value returned only for a valid opaque token. */
export interface CsrfTokenView {
  readonly csrfToken: string
}

/** Revalidates a session and derives its CSRF token with the dedicated key. */
export class GetCsrfTokenQuery {
  public constructor(private readonly sessions: SessionStorePort) {}

  public async execute(
    rawToken: string,
    nowMs: number,
  ): Promise<CsrfTokenView> {
    const record = await this.sessions.readAndTouch(rawToken, nowMs)
    if (record === undefined) throw new AuthenticationRequiredError()
    return Object.freeze({ csrfToken: this.sessions.csrfToken(record) })
  }
}
