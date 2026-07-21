import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

import {
  generateModule,
  publishModuleTrees,
} from '@scripts/module-generator/generate-module'

async function readTree(
  root: string,
): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {}

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      } else {
        const key = relative(root, path).split(sep).join('/')
        result[key] = await readFile(path, 'utf8')
      }
    }
  }

  await visit(root)
  return result
}

describe('module generator', () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { force: true, recursive: true })),
    )
  })

  it('matches the checked golden module byte for byte', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'module-generator-'))
    temporaryRoots.push(projectRoot)

    const result = await generateModule({
      moduleName: 'order-management',
      projectRoot,
      templateRoot: join(process.cwd(), 'templates/module'),
    })

    const actual = await readTree(projectRoot)
    const expected = await readTree(
      join(process.cwd(), 'test/fixtures/module-generator/expected'),
    )

    expect(result.createdFiles).toEqual(Object.keys(expected).sort())
    expect(actual).toEqual(expected)
  })

  it('refuses overwrite before changing any target tree', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'module-generator-'))
    temporaryRoots.push(projectRoot)
    const existingDirectory = join(projectRoot, 'src/modules/order-management')
    await mkdir(existingDirectory, { recursive: true })
    await writeFile(join(existingDirectory, 'owned.txt'), 'keep\n', 'utf8')

    await expect(
      generateModule({
        moduleName: 'order-management',
        projectRoot,
        templateRoot: join(process.cwd(), 'templates/module'),
      }),
    ).rejects.toThrow('Module target already exists')

    await expect(
      readFile(join(existingDirectory, 'owned.txt'), 'utf8'),
    ).resolves.toBe('keep\n')
    await expect(
      readdir(join(projectRoot, 'test'), { recursive: true }),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses the project-local external template by default', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'module-generator-'))
    temporaryRoots.push(projectRoot)
    await mkdir(join(projectRoot, 'templates'), { recursive: true })
    await cp(
      join(process.cwd(), 'templates/module'),
      join(projectRoot, 'templates/module'),
      { recursive: true },
    )

    const result = await generateModule({
      moduleName: 'order-management',
      projectRoot,
    })

    expect(result.createdFiles).toHaveLength(9)
    await expect(
      readFile(
        join(
          projectRoot,
          'src/modules/order-management/composition/order-management.module.ts',
        ),
        'utf8',
      ),
    ).resolves.toContain('export class OrderManagementModule')
  })

  it.each(['src/modules', 'test/unit/modules', 'test/architecture/modules'])(
    'rejects a symlinked final target ancestor %s without writing through it',
    async (ancestor) => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'module-generator-'))
      const outsideRoot = await mkdtemp(join(tmpdir(), 'module-outside-'))
      temporaryRoots.push(projectRoot, outsideRoot)
      const ancestorPath = join(projectRoot, ancestor)
      await mkdir(dirname(ancestorPath), { recursive: true })
      await symlink(outsideRoot, ancestorPath)

      await expect(
        generateModule({
          moduleName: 'order-management',
          projectRoot,
          templateRoot: join(process.cwd(), 'templates/module'),
        }),
      ).rejects.toThrow('Module target tree contains a symlink')

      await expect(readdir(outsideRoot)).resolves.toEqual([])
      await expect(
        readFile(
          join(
            projectRoot,
            'src/modules/order-management/composition/order-management.module.ts',
          ),
          'utf8',
        ),
      ).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it('treats a dangling final symlink as unsafe before creating sibling parents', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'module-generator-'))
    temporaryRoots.push(projectRoot)
    const finalModuleDirectory = join(
      projectRoot,
      'src/modules/order-management',
    )
    await mkdir(dirname(finalModuleDirectory), { recursive: true })
    await symlink(join(projectRoot, 'missing-target'), finalModuleDirectory)

    await expect(
      generateModule({
        moduleName: 'order-management',
        projectRoot,
        templateRoot: join(process.cwd(), 'templates/module'),
      }),
    ).rejects.toThrow('Module target tree contains a symlink')

    await expect(
      readdir(join(projectRoot, 'test'), { recursive: true }),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a final directory that appears during exclusive reservation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'module-publisher-'))
    temporaryRoots.push(root)
    const stagingDirectory = join(root, 'staging/module')
    const finalDirectory = join(root, 'final/module')
    await mkdir(stagingDirectory, { recursive: true })
    await mkdir(dirname(finalDirectory), { recursive: true })
    await writeFile(join(stagingDirectory, 'module.ts'), 'export {}\n', 'utf8')
    const publishWithReservation = publishModuleTrees as (
      publications: readonly {
        readonly finalDirectory: string
        readonly stagingDirectory: string
      }[],
      moveDirectory: typeof rename,
      reserveDirectory: (target: string) => Promise<void>,
    ) => Promise<void>

    await expect(
      publishWithReservation(
        [{ finalDirectory, stagingDirectory }],
        rename,
        async (target) => {
          await mkdir(target)
          await mkdir(target)
        },
      ),
    ).rejects.toMatchObject({ code: 'EEXIST' })

    await expect(readdir(finalDirectory)).resolves.toEqual([])
    await expect(
      readFile(join(stagingDirectory, 'module.ts'), 'utf8'),
    ).resolves.toBe('export {}\n')
  })

  it('removes every published tree when a later move fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'module-publisher-'))
    temporaryRoots.push(root)
    const stagingModuleDirectory = join(root, 'staging/module')
    const stagingUnitTestDirectory = join(root, 'staging/unit-test')
    const stagingArchitectureTestDirectory = join(
      root,
      'staging/architecture-test',
    )
    const finalModuleDirectory = join(root, 'final/module')
    const finalUnitTestDirectory = join(root, 'final/unit-test')
    const finalArchitectureTestDirectory = join(root, 'final/architecture-test')
    await mkdir(stagingModuleDirectory, { recursive: true })
    await mkdir(stagingUnitTestDirectory, { recursive: true })
    await mkdir(stagingArchitectureTestDirectory, { recursive: true })
    await mkdir(join(root, 'final'), { recursive: true })
    await writeFile(
      join(stagingModuleDirectory, 'module.ts'),
      'export {}\n',
      'utf8',
    )
    await writeFile(
      join(stagingUnitTestDirectory, 'module.spec.ts'),
      'export {}\n',
      'utf8',
    )
    await writeFile(
      join(stagingArchitectureTestDirectory, 'module.architecture.spec.ts'),
      'export {}\n',
      'utf8',
    )
    let moveCount = 0

    await expect(
      publishModuleTrees(
        [
          {
            finalDirectory: finalModuleDirectory,
            stagingDirectory: stagingModuleDirectory,
          },
          {
            finalDirectory: finalUnitTestDirectory,
            stagingDirectory: stagingUnitTestDirectory,
          },
          {
            finalDirectory: finalArchitectureTestDirectory,
            stagingDirectory: stagingArchitectureTestDirectory,
          },
        ],
        async (source, target) => {
          moveCount += 1
          if (moveCount === 3) {
            throw new Error('injected architecture-tree move failure')
          }
          await rename(source, target)
        },
      ),
    ).rejects.toThrow('injected architecture-tree move failure')

    await expect(
      readFile(join(finalModuleDirectory, 'module.ts'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(join(finalUnitTestDirectory, 'module.spec.ts'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(
        join(stagingArchitectureTestDirectory, 'module.architecture.spec.ts'),
        'utf8',
      ),
    ).resolves.toBe('export {}\n')
  })
})
