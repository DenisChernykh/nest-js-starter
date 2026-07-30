import 'dotenv/config'

import { startObservability } from '@/bootstrap/observability/start-observability'
import type { ApplicationRuntimeConfig } from '@/platform/config/runtime-config.types'
import { createApiRuntimeConfig } from '@/platform/config/runtime-environment'
import type { StructuredLogAttribute } from '@/platform/logging/logging.contracts'
import { PinoLogSink } from '@/platform/logging/pino-log.sink'

function findErrorCode(error: unknown): string | undefined {
  const visited = new Set<Error>()
  let current = error
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current)
    const code = (current as NodeJS.ErrnoException).code
    if (typeof code === 'string') return code
    current = current.cause
  }
  return undefined
}

function startupFailureAttributes(
  error: unknown,
  config: ApplicationRuntimeConfig,
): Readonly<Record<string, StructuredLogAttribute>> {
  if (findErrorCode(error) === 'EADDRINUSE') {
    return {
      reasonCode: 'ADDRESS_IN_USE',
      apiHost: config.http.host,
      apiPort: config.http.port,
    }
  }
  return { reasonCode: 'STARTUP_FAILED' }
}

/**
 * Starts the API and safely records failures after logging is configured.
 *
 * @throws Re-throws startup failures after publishing bounded diagnostics.
 */
export async function main(): Promise<void> {
  const config = createApiRuntimeConfig()
  const logger = new PinoLogSink(config)
  const observability = startObservability(config, logger)
  const { runApi } = await import('./run-api.js')
  try {
    await runApi(config, observability.runtime)
  } catch (error: unknown) {
    logger.write({
      level: 'fatal',
      event: 'api_startup_failed',
      module: 'Bootstrap',
      attributes: startupFailureAttributes(error, config),
      error,
    })
    throw error
  }
}

void main().catch(() => {
  process.exitCode = 1
})
