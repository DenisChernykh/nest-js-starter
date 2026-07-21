import { ApiRuntime } from './api-runtime'
import { configureApi } from './configure-api'
import { GracefulShutdownCoordinator } from './graceful-shutdown'
import { installProcessSignalHandlers } from './process-signals'
import type { ApplicationRuntimeConfig } from '@/platform/config/runtime-config.types'
import type { ObservabilityRuntime } from '@/platform/observability/observability.runtime'

/** Starts the instrumented API after the bootstrap has registered OpenTelemetry. */
export async function runApi(
  config: ApplicationRuntimeConfig,
  observability: ObservabilityRuntime,
): Promise<void> {
  const runtime = new ApiRuntime(() => configureApi(config, observability))
  const coordinator = new GracefulShutdownCoordinator(runtime)
  const uninstallSignalHandlers = installProcessSignalHandlers(
    coordinator,
    config.http.shutdownGraceMs,
  )
  try {
    await runtime.start()
  } catch (error: unknown) {
    uninstallSignalHandlers()
    await observability
      .close(AbortSignal.timeout(config.observability.exporterTimeoutMs))
      .catch(() => undefined)
    throw error
  }
}
