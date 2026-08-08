export type PublicAuthOperation =
  | 'register'
  | 'email-verification-resend'
  | 'password-reset-request'
  | 'invitation-accept'

export interface PublicAuthRateLimiterPort {
  consume(input: {
    readonly operation: PublicAuthOperation
    readonly ipAddress: string
    readonly normalizedEmail: string
  }): Promise<
    | { readonly allowed: true }
    | { readonly allowed: false; readonly retryAfterMs: number }
  >
}

export const PUBLIC_AUTH_RATE_LIMITER: unique symbol = Symbol(
  'PUBLIC_AUTH_RATE_LIMITER',
)
