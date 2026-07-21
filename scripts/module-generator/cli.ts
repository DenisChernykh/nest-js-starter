import { generateModule } from './generate-module'

async function main(): Promise<void> {
  const moduleName = process.argv[2]
  if (moduleName === undefined || process.argv.length !== 3) {
    process.stderr.write('Usage: pnpm generate:module <kebab-case-name>\n')
    process.exitCode = 1
    return
  }

  try {
    const result = await generateModule({
      moduleName,
      projectRoot: process.cwd(),
    })
    process.stdout.write(
      `Created ${result.createdFiles.length} files for ${moduleName}\n`,
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}

void main()
