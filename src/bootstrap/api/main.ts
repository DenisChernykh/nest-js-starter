import { ApiRuntime } from './api-runtime'
import { GracefulShutdownCoordinator } from './graceful-shutdown'
import { installProcessSignalHandlers } from './process-signals'

/** Starts the API process and records a non-zero exit code on failure. */
export async function main(): Promise<void> {
  const runtime = new ApiRuntime()
  const coordinator = new GracefulShutdownCoordinator(runtime)
  installProcessSignalHandlers(coordinator, 10_000)
  await runtime.start()
}

void main().catch(() => {
  process.exitCode = 1
})
