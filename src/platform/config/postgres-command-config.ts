import type { PostgresCommandRuntimeConfig } from './runtime-config.types'
import { buildPostgresCommandConfig } from './runtime-environment'

/**
 * Builds validated database configuration for a PostgreSQL-only command.
 *
 * @remarks Redis, auth and HTTP values are neither required nor synthesized.
 */
export function createPostgresCommandRuntimeConfig(): PostgresCommandRuntimeConfig {
  return buildPostgresCommandConfig(process.env)
}
