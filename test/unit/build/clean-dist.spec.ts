import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cleanDist } from '@scripts/build/clean-dist'

describe('cleanDist', () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { force: true, recursive: true })),
    )
  })

  it('deletes stale nested build output without touching sibling files', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'clean-dist-'))
    temporaryRoots.push(projectRoot)
    const staleFile = join(projectRoot, 'dist/stale/removed-source.js')
    const sourceFile = join(projectRoot, 'src/current-source.ts')
    const configFile = join(projectRoot, 'tsconfig.json')
    await mkdir(join(projectRoot, 'dist/stale'), { recursive: true })
    await mkdir(join(projectRoot, 'src'), { recursive: true })
    await Promise.all([
      writeFile(staleFile, 'stale', 'utf8'),
      writeFile(sourceFile, 'export {}', 'utf8'),
      writeFile(configFile, '{}', 'utf8'),
    ])

    await cleanDist(projectRoot)

    await expect(access(staleFile)).rejects.toThrow()
    await expect(access(sourceFile)).resolves.toBeUndefined()
    await expect(access(configFile)).resolves.toBeUndefined()
  })

  it('rejects a filesystem root as the project root', async () => {
    await expect(cleanDist('/')).rejects.toThrow(
      'Refusing to clean dist from a filesystem root',
    )
  })
})
