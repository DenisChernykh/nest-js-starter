import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Captures one local dependency-cruiser execution.
 */
export interface ArchitectureCommandResult {
  readonly exitCode: number
  readonly output: string
}

/**
 * Executes the pinned local dependency-cruiser against one fixture tree.
 *
 * @param inputPath - Repository-relative source or fixture directory.
 * @returns Exit code and combined standard output/error.
 */
export function runArchitectureCommand(
  inputPath: string,
): ArchitectureCommandResult {
  const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  const result = spawnSync(
    command,
    [
      'pnpm@11.15.1',
      'exec',
      'depcruise',
      '--config',
      '.dependency-cruiser.cjs',
      '--output-type',
      'err',
      resolve(inputPath),
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  )

  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  }
}
