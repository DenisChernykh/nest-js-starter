import { ConfigService } from '@nestjs/config'

import { RuntimeConfigService } from './runtime-config.service'
import type { ValidatedRuntimeEnvironment } from './runtime-config.types'
import { validateRuntimeEnvironment } from './runtime-environment'

const placeholderSecret = (byte: number): string =>
  Buffer.alloc(32, byte).toString('base64url')

/**
 * Builds validated database configuration for a PostgreSQL-only command.
 *
 * @remarks Redis and auth placeholders satisfy the shared schema but are not
 * exposed to the command and never create a Redis client or HTTP listener.
 */
export function createPostgresCommandRuntimeConfig(): RuntimeConfigService {
  const environment = validateRuntimeEnvironment({
    ...process.env,
    NODE_ENV: 'development',
    PUBLIC_API_URL: 'http://localhost:3000',
    CORS_ORIGINS: 'http://localhost:3000',
    REDIS_COORDINATION_URL: 'redis://127.0.0.1:1',
    AUTH_SESSION_KEY_SECRET: placeholderSecret(1),
    AUTH_CSRF_SECRET: placeholderSecret(2),
    AUTH_RATE_LIMIT_KEY_SECRET: placeholderSecret(3),
    AUTH_NETWORK_METADATA_SECRET: placeholderSecret(4),
    AUTH_CSRF_ORIGINS: 'http://localhost:3000',
  })
  return new RuntimeConfigService(
    new ConfigService<ValidatedRuntimeEnvironment, true>(environment),
  )
}
