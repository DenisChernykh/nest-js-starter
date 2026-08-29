import type { IssuedBrowserSession } from './session-issuance.contract'

/** Exact versioned Redis payload for one opaque browser session. */
export interface StoredSessionRecord {
  readonly schema: 1
  readonly publicId: string
  readonly userId: string
  readonly sessionGeneration: string
  readonly globalSessionEpoch: string
  readonly csrfSeed: string
  readonly createdAtMs: number
  readonly lastSeenAtMs: number
  readonly absoluteExpiresAtMs: number
  readonly deviceLabel: string
  readonly networkFingerprint: string
}

/** Durable values and safe metadata required to issue one browser session. */
export interface IssueSessionInput {
  readonly userId: string
  readonly sessionGeneration: bigint
  readonly globalSessionEpoch: bigint
  readonly nowMs: number
  readonly deviceLabel: string
  readonly networkFingerprint: string
}

/** Safe session metadata shown to its owning authenticated user. */
export interface BrowserSessionSummary {
  readonly publicId: string
  readonly createdAt: Date
  readonly lastSeenAt: Date
  readonly absoluteExpiresAt: Date
  readonly deviceLabel: string
  readonly current: boolean
}

/** Auth-store boundary for opaque browser sessions. */
export interface SessionStorePort {
  /** Creates an indexed session with finite idle and absolute expiries. */
  issue(input: IssueSessionInput): Promise<IssuedBrowserSession>
  /** Reads and atomically touches a valid session addressed by its raw token. */
  readAndTouch(
    rawToken: string,
    nowMs: number,
  ): Promise<StoredSessionRecord | undefined>
  /** Derives the session-bound CSRF token from a validated record. */
  csrfToken(record: StoredSessionRecord): string
  /** Lists only validated sessions owned by one user. */
  list(
    userId: string,
    currentPublicId: string,
  ): Promise<readonly BrowserSessionSummary[]>
  /** Revokes one public session identifier only when owned by the user. */
  revoke(userId: string, publicId: string): Promise<boolean>
  /** Revokes the currently indexed sessions for one user. */
  revokeAll(userId: string): Promise<number>
}

/** Injection token for the opaque browser-session auth boundary. */
export const SESSION_STORE: unique symbol = Symbol('SESSION_STORE')
