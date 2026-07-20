import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { parseModuleName } from './module-name'
import { renderModuleFiles } from './module-template'

/**
 * Configures one module generation.
 */
export interface GenerateModuleOptions {
  readonly moduleName: string
  readonly projectRoot: string
  readonly templateRoot?: string
}

/**
 * Reports module files published through staging and compensating cleanup.
 */
export interface GenerateModuleResult {
  readonly createdFiles: readonly string[]
  readonly moduleDirectory: string
}

/**
 * Identifies one staged/final directory pair participating in publication.
 */
export interface ModuleTreePublication {
  readonly finalDirectory: string
  readonly stagingDirectory: string
}

/**
 * Moves one fully prepared tree child into an owned final directory.
 */
export type MoveDirectory = (source: string, target: string) => Promise<void>

/**
 * Exclusively creates one final publication directory.
 */
export type ReserveDirectory = (target: string) => Promise<void>

interface ReservedDirectory {
  readonly device: number
  readonly inode: number
  readonly path: string
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === 'object' && 'code' in error
}

/**
 * Converts non-Error publication failures into a stable throwable value.
 *
 * @param error - Unknown failure caught from injected or filesystem operations.
 * @returns Original Error/errno object or a wrapped unknown failure.
 */
function normalizePublicationError(error: unknown): Error {
  return error instanceof Error || isErrnoException(error)
    ? error
    : new Error('Unknown module-tree publication failure', {
        cause: error,
      })
}

/**
 * Reads one path entry without following its final symbolic link.
 *
 * @param path - Absolute filesystem path to inspect.
 * @returns Entry metadata, or undefined when the entry does not exist.
 * @throws Error for filesystem failures other than a missing entry.
 */
async function lstatIfExists(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return undefined
    }
    throw error instanceof Error
      ? error
      : new Error(`Unable to inspect generated target: ${path}`, {
          cause: error,
        })
  }
}

/**
 * Confirms that a generated path is a strict child of its owning root.
 *
 * @param root - Absolute canonical root.
 * @param target - Absolute path expected below the root.
 * @returns Relative path components from root to target.
 * @throws Error when the target equals or escapes the root.
 */
function containedSegments(root: string, target: string): readonly string[] {
  const relativeTarget = relative(root, target)
  if (
    relativeTarget === '' ||
    isAbsolute(relativeTarget) ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    throw new Error(`Generated target escapes project root: ${target}`)
  }
  return relativeTarget.split(sep)
}

/**
 * Performs a read-only walk of one final target and all existing ancestors.
 *
 * @param projectRoot - Canonical project directory.
 * @param finalDirectory - Final module or test directory.
 * @throws Error for a symlink, non-directory ancestor or existing final entry.
 */
async function assertAvailableTargetTree(
  projectRoot: string,
  finalDirectory: string,
): Promise<void> {
  const segments = containedSegments(projectRoot, finalDirectory)
  let currentPath = projectRoot

  for (const [index, segment] of segments.entries()) {
    currentPath = join(currentPath, segment)
    const entry = await lstatIfExists(currentPath)
    if (entry === undefined) {
      return
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`Module target tree contains a symlink: ${currentPath}`)
    }
    const isFinalEntry = index === segments.length - 1
    if (!entry.isDirectory()) {
      if (isFinalEntry) {
        throw new Error(
          `Module target already exists: ${finalDirectory.split(sep).at(-1)}`,
        )
      }
      throw new Error(
        `Module target tree contains a non-directory entry: ${currentPath}`,
      )
    }
    if (isFinalEntry) {
      throw new Error(
        `Module target already exists: ${finalDirectory.split(sep).at(-1)}`,
      )
    }
  }
}

/**
 * Verifies that every component through a directory is an actual directory.
 *
 * @param projectRoot - Canonical project directory.
 * @param directory - Existing directory at or below the project root.
 * @throws Error when a component is missing, a symlink or a non-directory.
 */
async function assertExistingDirectoryChain(
  projectRoot: string,
  directory: string,
): Promise<void> {
  const rootEntry = await lstat(projectRoot)
  if (rootEntry.isSymbolicLink()) {
    throw new Error(`Module target tree contains a symlink: ${projectRoot}`)
  }
  if (!rootEntry.isDirectory()) {
    throw new Error(
      `Module target tree contains a non-directory entry: ${projectRoot}`,
    )
  }
  if (directory === projectRoot) {
    return
  }

  let currentPath = projectRoot
  for (const segment of containedSegments(projectRoot, directory)) {
    currentPath = join(currentPath, segment)
    const entry = await lstatIfExists(currentPath)
    if (entry === undefined) {
      throw new Error(`Module target tree component is missing: ${currentPath}`)
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`Module target tree contains a symlink: ${currentPath}`)
    }
    if (!entry.isDirectory()) {
      throw new Error(
        `Module target tree contains a non-directory entry: ${currentPath}`,
      )
    }
  }
}

/**
 * Creates missing target parents one component at a time.
 *
 * @param projectRoot - Canonical existing project directory.
 * @param directory - Final parent directory to ensure.
 * @throws Error when an existing or concurrently appearing component is unsafe.
 */
async function ensureSafeDirectory(
  projectRoot: string,
  directory: string,
): Promise<void> {
  const segments = containedSegments(projectRoot, directory)
  let currentPath = projectRoot

  for (const segment of segments) {
    await assertExistingDirectoryChain(projectRoot, currentPath)
    currentPath = join(currentPath, segment)
    let entry = await lstatIfExists(currentPath)
    if (entry === undefined) {
      try {
        await mkdir(currentPath)
      } catch (error: unknown) {
        if (!isErrnoException(error) || error.code !== 'EEXIST') {
          throw error
        }
      }
      entry = await lstatIfExists(currentPath)
    }
    if (entry?.isSymbolicLink()) {
      throw new Error(`Module target tree contains a symlink: ${currentPath}`)
    }
    if (entry === undefined || !entry.isDirectory()) {
      throw new Error(
        `Module target tree contains a non-directory entry: ${currentPath}`,
      )
    }
  }
}

/**
 * Removes only final roots whose filesystem identity still matches a reservation.
 *
 * @param reservations - Successfully owned final roots in creation order.
 * @param failure - Reservation or child-publication failure to preserve.
 * @throws Original failure, or AggregateError when owned-root cleanup also fails.
 */
async function compensateReservations(
  reservations: readonly ReservedDirectory[],
  failure: unknown,
): Promise<never> {
  const normalizedFailure = normalizePublicationError(failure)
  const errors: unknown[] = [normalizedFailure]

  for (const reservation of reservations.toReversed()) {
    try {
      const entry = await lstatIfExists(reservation.path)
      if (
        entry === undefined ||
        entry.dev !== reservation.device ||
        entry.ino !== reservation.inode
      ) {
        continue
      }
      await rm(reservation.path, { force: true, recursive: true })
    } catch (cleanupError: unknown) {
      errors.push(cleanupError)
    }
  }

  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'Module-tree publication and compensating cleanup both failed',
    )
  }
  throw normalizedFailure
}

function assertContained(root: string, target: string): void {
  const relativeTarget = relative(root, target)
  if (
    relativeTarget === '' ||
    isAbsolute(relativeTarget) ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    throw new Error(`Generated target escapes staging root: ${target}`)
  }
}

/**
 * Publishes prepared trees and compensates every completed move on failure.
 *
 * @param publications - Ordered staged/final directory pairs.
 * @param moveDirectory - Tree-child move implementation; replace only to test
 * compensating failure.
 * @param reserveDirectory - Exclusive non-recursive final-root reservation.
 * @throws Error for an empty publication set, a failed move or failed cleanup.
 */
export async function publishModuleTrees(
  publications: readonly ModuleTreePublication[],
  moveDirectory: MoveDirectory = rename,
  reserveDirectory: ReserveDirectory = async (target) => {
    await mkdir(target)
  },
): Promise<void> {
  if (publications.length === 0) {
    throw new Error('Module tree publication requires at least one directory')
  }

  const reservations: ReservedDirectory[] = []
  try {
    for (const publication of publications) {
      await reserveDirectory(publication.finalDirectory)
      const entry = await lstat(publication.finalDirectory)
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(
          `Module tree reservation is not a directory: ${publication.finalDirectory}`,
        )
      }
      reservations.push({
        device: entry.dev,
        inode: entry.ino,
        path: publication.finalDirectory,
      })
    }

    for (const [index, publication] of publications.entries()) {
      const reservation = reservations[index]
      if (reservation === undefined) {
        throw new Error('Missing owned module-tree reservation')
      }
      const entry = await lstatIfExists(reservation.path)
      if (
        entry === undefined ||
        entry.dev !== reservation.device ||
        entry.ino !== reservation.inode ||
        entry.isSymbolicLink() ||
        !entry.isDirectory()
      ) {
        throw new Error(
          `Module tree reservation changed before publication: ${reservation.path}`,
        )
      }
      const children = await readdir(publication.stagingDirectory)
      for (const child of children.sort()) {
        await moveDirectory(
          join(publication.stagingDirectory, child),
          join(publication.finalDirectory, child),
        )
      }
    }
  } catch (publishError: unknown) {
    await compensateReservations(reservations, publishError)
  }
}

/**
 * Generates a five-layer module shell without adding business behavior.
 *
 * @param options - Target project root, normalized module name and optional
 * external template root used by tests or advanced tooling.
 * @returns Published module directory and stable created-file list.
 * @throws Error when a target exists, a template is invalid, a path is unsafe
 * or one of the staged subtrees cannot be published.
 */
export async function generateModule(
  options: GenerateModuleOptions,
): Promise<GenerateModuleResult> {
  const requestedProjectRoot = resolve(options.projectRoot)
  await mkdir(requestedProjectRoot, { recursive: true })
  const projectRoot = await realpath(requestedProjectRoot)
  const templateRoot = resolve(
    options.templateRoot ?? join(projectRoot, 'templates', 'module'),
  )
  const name = parseModuleName(options.moduleName)
  const finalModuleDirectory = join(
    projectRoot,
    'src',
    'modules',
    name.kebabCase,
  )
  const finalUnitTestDirectory = join(
    projectRoot,
    'test',
    'unit',
    'modules',
    name.kebabCase,
  )
  const finalArchitectureTestDirectory = join(
    projectRoot,
    'test',
    'architecture',
    'modules',
    name.kebabCase,
  )

  const publications = [
    {
      finalDirectory: finalModuleDirectory,
      stagingDirectory: '',
    },
    {
      finalDirectory: finalUnitTestDirectory,
      stagingDirectory: '',
    },
    {
      finalDirectory: finalArchitectureTestDirectory,
      stagingDirectory: '',
    },
  ] satisfies ModuleTreePublication[]

  for (const publication of publications) {
    await assertAvailableTargetTree(projectRoot, publication.finalDirectory)
  }

  const renderedFiles = await renderModuleFiles(templateRoot, name)
  const stagingRoot = await mkdtemp(join(projectRoot, '.module-staging-'))

  try {
    for (const file of renderedFiles) {
      const stagedTarget = resolve(stagingRoot, file.target)
      assertContained(stagingRoot, stagedTarget)
      await mkdir(dirname(stagedTarget), { recursive: true })
      await writeFile(stagedTarget, file.content, {
        encoding: 'utf8',
        flag: 'wx',
      })
    }

    for (const publication of publications) {
      await ensureSafeDirectory(
        projectRoot,
        dirname(publication.finalDirectory),
      )
    }

    await publishModuleTrees(
      [
        {
          finalDirectory: finalModuleDirectory,
          stagingDirectory: join(stagingRoot, 'src', 'modules', name.kebabCase),
        },
        {
          finalDirectory: finalUnitTestDirectory,
          stagingDirectory: join(
            stagingRoot,
            'test',
            'unit',
            'modules',
            name.kebabCase,
          ),
        },
        {
          finalDirectory: finalArchitectureTestDirectory,
          stagingDirectory: join(
            stagingRoot,
            'test',
            'architecture',
            'modules',
            name.kebabCase,
          ),
        },
      ],
      rename,
      async (target) => {
        await assertExistingDirectoryChain(projectRoot, dirname(target))
        await mkdir(target)
      },
    )

    return {
      createdFiles: renderedFiles.map((file) => file.target),
      moduleDirectory: finalModuleDirectory,
    }
  } finally {
    await rm(stagingRoot, { force: true, recursive: true })
  }
}
