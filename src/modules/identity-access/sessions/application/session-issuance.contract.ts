export interface IssueBrowserSessionInput {
  readonly userId: string
  readonly nowMs: number
  readonly deviceLabel: string
  readonly networkFingerprint: string
}

export interface IssuedBrowserSession {
  readonly rawToken: string
  readonly publicId: string
  readonly csrfToken: string
  readonly absoluteExpiresAt: Date
}
