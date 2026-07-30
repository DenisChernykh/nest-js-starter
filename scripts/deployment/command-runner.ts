import { execFile } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'

const maximumOutputBytes = 1024 * 1024

/** Bounded shell-free child-process request. */
export interface CommandInput {
  readonly file: string
  readonly arguments: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
  readonly stdin?: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

/** Captured bounded child-process result. */
export interface CommandOutcome {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

/**
 * Executes commands without interpreting arguments through a shell.
 */
export interface CommandRunner {
  /**
   * Runs one process with bounded time and output.
   *
   * @param input - Executable, literal arguments and explicit environment additions.
   * @returns Exit and output data, including non-zero exits and timeouts.
   */
  run(input: CommandInput): Promise<CommandOutcome>
}

function boundOutput(value: string): string {
  const bytes = Buffer.from(value)
  return bytes.length <= maximumOutputBytes
    ? value
    : bytes.subarray(0, maximumOutputBytes).toString('utf8')
}

function exitCode(error: ExecFileException | null): number {
  if (error === null) return 0
  return typeof error.code === 'number' ? error.code : 1
}

/**
 * Node child-process runner with a one-MiB output ceiling.
 *
 * @remarks
 * The runner never uses a shell and never embeds captured output in thrown
 * errors. Environment entries supplied by the caller override inherited keys.
 */
export class NodeCommandRunner implements CommandRunner {
  /**
   * Runs one child with inherited environment, explicit additions and timeout.
   *
   * @param input - Validated process request.
   * @returns A frozen outcome; launch, exit and timeout failures remain data.
   * @throws DOMException when the caller aborts the operation.
   */
  run(input: CommandInput): Promise<CommandOutcome> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        input.file,
        [...input.arguments],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: { ...process.env, ...input.environment },
          maxBuffer: maximumOutputBytes,
          timeout: input.timeoutMs,
          signal: input.signal,
        },
        (error, stdout, stderr) => {
          if (error?.name === 'AbortError') {
            const abortError = new Error('Command aborted')
            abortError.name = 'AbortError'
            reject(abortError)
            return
          }
          resolve(
            Object.freeze({
              exitCode: exitCode(error),
              stdout: boundOutput(stdout),
              stderr: boundOutput(stderr),
              timedOut:
                error !== null &&
                error.killed === true &&
                error.signal === 'SIGTERM',
            }),
          )
        },
      )

      child.stdin?.on('error', () => {
        // Process launch and early-exit failures are reported by the callback.
      })
      child.stdin?.end(input.stdin)
    })
  }
}
