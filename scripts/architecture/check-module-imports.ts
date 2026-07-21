import { resolve } from 'node:path'

import {
  findDatabaseBoundaryViolations,
  findModuleImportViolations,
  findRuntimeConfigAccessViolations,
  findUnsafeEndpointViolations,
} from './module-import-policy'

async function main(): Promise<void> {
  const sourceRoot = resolve(process.argv[2] ?? 'src')
  const [
    databaseViolations,
    moduleViolations,
    runtimeConfigViolations,
    unsafeEndpointViolations,
  ] = await Promise.all([
    findDatabaseBoundaryViolations(sourceRoot),
    findModuleImportViolations(sourceRoot),
    findRuntimeConfigAccessViolations(sourceRoot),
    findUnsafeEndpointViolations(sourceRoot),
  ])
  const violations = [
    ...databaseViolations,
    ...moduleViolations,
    ...runtimeConfigViolations,
    ...unsafeEndpointViolations,
  ]

  if (violations.length > 0) {
    for (const violation of violations) {
      process.stderr.write(
        `${violation.reason}: ${violation.file} -> ${violation.specifier}\n`,
      )
    }
    process.exitCode = 1
  } else {
    process.stdout.write('module import policy: valid\n')
  }
}

void main()
