import 'dotenv/config'

import { startObservability } from '@/bootstrap/observability/start-observability'
import { createApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { PinoLogSink } from '@/platform/logging/pino-log.sink'

/** Starts the API process and records a non-zero exit code on failure. */
export async function main(): Promise<void> {
  const config = createApiRuntimeConfig()
  const logger = new PinoLogSink(config)
  const observability = startObservability(config, logger)
  const { runApi } = await import('./run-api.js')
  await runApi(config, observability.runtime)
}

void main().catch(() => {
  process.exitCode = 1
})
