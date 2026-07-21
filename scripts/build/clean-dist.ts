import { rm } from 'node:fs/promises'
import { join, parse, resolve } from 'node:path'

/**
 * Removes only the build output owned by a repository checkout.
 *
 * @param projectRoot - Repository root whose direct `dist` child is removed.
 * @throws Error when the supplied path resolves to a filesystem root.
 */
export async function cleanDist(projectRoot: string): Promise<void> {
  const resolvedProjectRoot = resolve(projectRoot)
  if (parse(resolvedProjectRoot).root === resolvedProjectRoot) {
    throw new Error('Refusing to clean dist from a filesystem root')
  }

  await rm(join(resolvedProjectRoot, 'dist'), {
    force: true,
    recursive: true,
  })
}

async function main(): Promise<void> {
  await cleanDist(process.cwd())
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
