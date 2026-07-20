import { resolve } from 'node:path'

import { findModuleImportViolations } from './module-import-policy'

async function main(): Promise<void> {
  const sourceRoot = resolve(process.argv[2] ?? 'src')
  const violations = await findModuleImportViolations(sourceRoot)

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
