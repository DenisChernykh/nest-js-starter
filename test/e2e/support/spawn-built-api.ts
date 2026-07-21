import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** Spawns the compiled API without an intermediate shell. */
export function spawnBuiltApi(
  environment: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ['dist/bootstrap/api/main.js'], {
    cwd: process.cwd(),
    env: environment,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/** Captures UTF-8 stdout and stderr from one spawned API process. */
export function captureChildOutput(
  child: ChildProcessWithoutNullStreams,
): () => string {
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  return () => output
}

/** Waits for process exit and also observes a process that already exited. */
export function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<{
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
    })
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Child exit deadline exceeded')),
      timeoutMs,
    )
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    })
  })
}
