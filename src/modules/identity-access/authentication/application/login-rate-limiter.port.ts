/** One login attempt evaluated against both network and account buckets. */
export interface LoginRateLimitInput {
  readonly ipAddress: string
  readonly normalizedEmail: string
}

/** Atomic two-bucket limiter decision with bounded retry metadata. */
export type LoginRateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMs: number }

/** Required auth boundary for distributed login throttling. */
export interface LoginRateLimiterPort {
  /** Consumes one attempt in both buckets or fails closed on dependency loss. */
  consume(input: LoginRateLimitInput): Promise<LoginRateLimitDecision>
}

/** Injection token for the distributed login-attempt auth boundary. */
export const LOGIN_RATE_LIMITER: unique symbol = Symbol('LOGIN_RATE_LIMITER')
