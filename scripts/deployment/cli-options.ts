/** Supported deployment operator commands. */
export type DeploymentCommand = 'preflight' | 'promote' | 'rollback'

/** Parsed non-secret command-line options. */
export interface DeploymentCliOptions {
  readonly command: DeploymentCommand
  readonly manifestPath: string
  readonly apply: boolean
  readonly evidencePath?: string
}

const usage = `Usage:
  deployment:preflight --manifest <path>
  deployment:promote --manifest <path> [--apply --evidence <path>]
  deployment:rollback --manifest <path> --apply --evidence <path>`

function failUsage(): never {
  throw new Error(usage)
}

function readFlagValue(arguments_: readonly string[], index: number): string {
  const value = arguments_[index + 1]
  if (value === undefined || value === '' || value.startsWith('--')) {
    failUsage()
  }
  return value
}

/**
 * Parses the deployment CLI grammar without accepting secret-valued flags.
 *
 * @param arguments_ - Arguments after the executable and script path.
 * @returns Validated command options.
 * @throws Error with fixed usage text for every invalid combination.
 */
export function parseDeploymentCliOptions(
  arguments_: readonly string[],
): DeploymentCliOptions {
  const values =
    arguments_[0] === '--'
      ? arguments_.slice(1)
      : arguments_[1] === '--'
        ? [arguments_[0]!, ...arguments_.slice(2)]
        : [...arguments_]
  const command = values[0]
  if (
    command !== 'preflight' &&
    command !== 'promote' &&
    command !== 'rollback'
  ) {
    failUsage()
  }

  let manifestPath: string | undefined
  let evidencePath: string | undefined
  let apply = false

  for (let index = 1; index < values.length; index += 1) {
    const argument = values[index]
    switch (argument) {
      case '--manifest':
        if (manifestPath !== undefined) failUsage()
        manifestPath = readFlagValue(values, index)
        index += 1
        break
      case '--evidence':
        if (evidencePath !== undefined) failUsage()
        evidencePath = readFlagValue(values, index)
        index += 1
        break
      case '--apply':
        if (apply) failUsage()
        apply = true
        break
      default:
        failUsage()
    }
  }

  if (
    manifestPath === undefined ||
    (command === 'preflight' && (apply || evidencePath !== undefined)) ||
    (command === 'rollback' && !apply) ||
    (apply && evidencePath === undefined) ||
    (!apply && evidencePath !== undefined)
  ) {
    failUsage()
  }

  return Object.freeze({
    command,
    manifestPath,
    apply,
    ...(evidencePath === undefined ? {} : { evidencePath }),
  })
}
