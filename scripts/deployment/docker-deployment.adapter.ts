import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { CommandOutcome, CommandRunner } from './command-runner.js'
import type { ImageVerificationPort, MigratorPort } from './ports.js'

const commandTimeoutMs = 300_000
const temporaryPrefixName = 'nest-js-starter-deployment-auth-'

/**
 * Injectable filesystem boundary for isolated Docker authentication state.
 */
export interface DockerTemporaryDirectoryFunctions {
  /** Returns the operating system temporary directory. */
  temporaryRoot(): string

  /** Creates a unique directory from the supplied owned prefix. */
  create(prefix: string): Promise<string>

  /** Applies the exact requested mode to an owned directory. */
  changeMode(path: string, mode: number): Promise<void>

  /** Recursively removes one validated owned directory. */
  remove(path: string): Promise<void>
}

/**
 * Redacted Docker verification or migration failure.
 */
export class DockerDeploymentError extends Error {
  readonly operation: string
  readonly category: string

  /**
   * Creates an error containing fixed policy metadata only.
   *
   * @param operation - Fixed Docker operation name.
   * @param category - Fixed failure category.
   */
  constructor(operation: string, category: string) {
    super(`Docker deployment operation failed: ${operation} (${category})`)
    this.name = 'DockerDeploymentError'
    this.operation = operation
    this.category = category
  }

  /** Returns a serialization without command output, arguments or secrets. */
  toJSON(): Readonly<{
    name: string
    message: string
    operation: string
    category: string
  }> {
    return Object.freeze({
      name: this.name,
      message: this.message,
      operation: this.operation,
      category: this.category,
    })
  }
}

const nodeTemporaryDirectoryFunctions: DockerTemporaryDirectoryFunctions = {
  temporaryRoot: tmpdir,
  create: mkdtemp,
  changeMode: chmod,
  remove: (path) => rm(path, { recursive: true, force: true }),
}

function commandFailure(
  operation: string,
  outcome: CommandOutcome,
): DockerDeploymentError | undefined {
  if (outcome.timedOut) return new DockerDeploymentError(operation, 'timeout')
  if (outcome.exitCode !== 0) {
    return new DockerDeploymentError(operation, 'non-zero-exit')
  }
  return undefined
}

function requireSuccessfulCommand(
  operation: string,
  outcome: CommandOutcome,
): void {
  const failure = commandFailure(operation, outcome)
  if (failure !== undefined) throw failure
}

/**
 * Verifies immutable GHCR images and runs their one-shot Prisma migrator.
 *
 * @remarks
 * Registry credentials exist only in an isolated mode-0700 Docker config and
 * login stdin. The migration database URL is supplied only through the child
 * environment. Captured command output never reaches thrown errors.
 */
export class DockerDeploymentAdapter
  implements ImageVerificationPort, MigratorPort
{
  readonly #runner: CommandRunner
  readonly #temporary: DockerTemporaryDirectoryFunctions

  /**
   * Creates the adapter with explicit process and temporary-directory ports.
   *
   * @param runner - Bounded shell-free command runner.
   * @param temporary - Injectable isolated-directory operations.
   */
  constructor(
    runner: CommandRunner,
    temporary: DockerTemporaryDirectoryFunctions = nodeTemporaryDirectoryFunctions,
  ) {
    this.#runner = runner
    this.#temporary = temporary
  }

  /**
   * Pulls a digest-pinned GHCR image and checks its OCI source revision.
   *
   * @param input - Immutable artifact identity and in-memory GHCR credentials.
   * @throws DockerDeploymentError for unsafe input, command failure, timeout,
   * revision mismatch, logout failure or cleanup failure.
   */
  async verifyImage(input: {
    readonly imageRef: string
    readonly revision: string
    readonly registryUrl: string
    readonly username: string
    readonly password: string
  }): Promise<void> {
    if (input.registryUrl !== 'https://ghcr.io') {
      throw new DockerDeploymentError('validate-registry', 'input')
    }

    const ownedPrefix = join(
      this.#temporary.temporaryRoot(),
      temporaryPrefixName,
    )
    const directory = await this.#temporary.create(ownedPrefix)
    const ownedDirectory =
      directory.startsWith(ownedPrefix) && directory.length > ownedPrefix.length
    let loginSucceeded = false
    let failure: DockerDeploymentError | undefined

    try {
      if (!ownedDirectory) {
        throw new DockerDeploymentError('temporary-directory', 'unsafe-path')
      }
      await this.#temporary.changeMode(directory, 0o700)

      const login = await this.#runner.run({
        file: 'docker',
        arguments: [
          '--config',
          directory,
          'login',
          'ghcr.io',
          '--username',
          input.username,
          '--password-stdin',
        ],
        stdin: input.password,
        timeoutMs: commandTimeoutMs,
      })
      requireSuccessfulCommand('login', login)
      loginSucceeded = true

      const pull = await this.#runner.run({
        file: 'docker',
        arguments: ['--config', directory, 'pull', input.imageRef],
        timeoutMs: commandTimeoutMs,
      })
      requireSuccessfulCommand('pull', pull)

      const inspection = await this.#runner.run({
        file: 'docker',
        arguments: [
          'image',
          'inspect',
          input.imageRef,
          '--format',
          '{{index .Config.Labels "org.opencontainers.image.revision"}}',
        ],
        timeoutMs: commandTimeoutMs,
      })
      requireSuccessfulCommand('inspect-revision', inspection)
      if (inspection.stdout !== `${input.revision}\n`) {
        throw new DockerDeploymentError('inspect-revision', 'revision-mismatch')
      }
    } catch (error) {
      failure =
        error instanceof DockerDeploymentError
          ? error
          : new DockerDeploymentError('verification', 'local-operation')
    } finally {
      if (loginSucceeded) {
        try {
          const logout = await this.#runner.run({
            file: 'docker',
            arguments: ['--config', directory, 'logout', 'ghcr.io'],
            timeoutMs: commandTimeoutMs,
          })
          requireSuccessfulCommand('logout', logout)
        } catch (error) {
          failure ??=
            error instanceof DockerDeploymentError
              ? error
              : new DockerDeploymentError('logout', 'local-operation')
        }
      }

      if (ownedDirectory) {
        try {
          await this.#temporary.remove(directory)
        } catch {
          failure ??= new DockerDeploymentError(
            'temporary-directory-cleanup',
            'local-operation',
          )
        }
      }
    }

    if (failure !== undefined) throw failure
  }

  /**
   * Runs the exact image migrator with a database URL in child memory only.
   *
   * @param input - Digest-pinned image and migration database URL.
   * @returns The frozen child exit code; non-zero exits remain orchestration data.
   * @throws DockerDeploymentError when the bounded command times out.
   */
  async migrate(input: {
    readonly imageRef: string
    readonly databaseUrl: string
  }): Promise<{ readonly exitCode: number }> {
    const outcome = await this.#runner.run({
      file: 'docker',
      arguments: [
        'run',
        '--rm',
        '--env',
        'DATABASE_URL',
        '--entrypoint',
        'corepack',
        input.imageRef,
        'pnpm@11.15.1',
        'start:migrate',
      ],
      environment: { DATABASE_URL: input.databaseUrl },
      timeoutMs: commandTimeoutMs,
    })
    if (outcome.timedOut) {
      throw new DockerDeploymentError('migrate', 'timeout')
    }
    return Object.freeze({ exitCode: outcome.exitCode })
  }
}
