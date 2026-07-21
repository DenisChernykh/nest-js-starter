import type { GracefulShutdownCoordinator } from './graceful-shutdown'

/** Function used to terminate the process after shutdown coordination. */
export type ProcessExit = (code: number) => void

/** Installs idempotent SIGTERM/SIGINT handling with one hard watchdog. */
export function installProcessSignalHandlers(
  coordinator: GracefulShutdownCoordinator,
  graceMs: number,
  exit: ProcessExit = (code) => process.exit(code),
): () => void {
  let handling: Promise<void> | undefined
  let watchdog: NodeJS.Timeout | undefined
  const handle = (reason: string): void => {
    handling ??= (async () => {
      let exited = false
      const exitOnce = (code: number): void => {
        if (exited) return
        exited = true
        exit(code)
      }
      watchdog = setTimeout(() => exitOnce(1), graceMs)
      const result = await coordinator.shutdown(reason)
      clearTimeout(watchdog)
      watchdog = undefined
      exitOnce(result.exitCode)
    })()
  }
  const term = (): void => handle('SIGTERM')
  const interrupt = (): void => handle('SIGINT')
  process.on('SIGTERM', term)
  process.on('SIGINT', interrupt)
  return () => {
    process.off('SIGTERM', term)
    process.off('SIGINT', interrupt)
    if (watchdog !== undefined) clearTimeout(watchdog)
  }
}
