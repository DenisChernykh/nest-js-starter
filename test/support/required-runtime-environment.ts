/** Adds required Redis/auth config and disables incidental test telemetry. */
export function requiredRuntimeEnvironment(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    API_DOCS_MODE: 'public',
    OTEL_SDK_DISABLED: 'true',
    REDIS_COORDINATION_URL: 'redis://default:test@127.0.0.1:6379',
    AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
    AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
    AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
    AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
    AUTH_CSRF_ORIGINS: 'http://localhost:3000',
    ...overrides,
  }
}
