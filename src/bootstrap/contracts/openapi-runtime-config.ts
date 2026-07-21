import type { ApplicationRuntimeConfig } from '@/platform/config/runtime-config.types'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'

const contractSecrets = [1, 2, 3, 4].map((byte) =>
  Buffer.alloc(32, byte).toString('base64url'),
)

/**
 * Builds the fixed non-secret runtime projection used only for contract scans.
 *
 * @remarks PostgreSQL and Redis point at closed port 1 to make accidental I/O
 * fail fast. Correct generation performs no connection attempt.
 */
export function createOpenApiRuntimeConfig(): ApplicationRuntimeConfig {
  return buildApiRuntimeConfig({
    NODE_ENV: 'development',
    API_DOCS_MODE: 'off',
    OTEL_SDK_DISABLED: 'true',
    DATABASE_URL:
      'postgresql://contract:contract@127.0.0.1:1/contract?schema=public',
    REDIS_COORDINATION_URL: 'redis://default:contract@127.0.0.1:1',
    AUTH_SESSION_KEY_SECRET: contractSecrets[0],
    AUTH_CSRF_SECRET: contractSecrets[1],
    AUTH_RATE_LIMIT_KEY_SECRET: contractSecrets[2],
    AUTH_NETWORK_METADATA_SECRET: contractSecrets[3],
    AUTH_CSRF_ORIGINS: 'http://localhost:3000',
  })
}
