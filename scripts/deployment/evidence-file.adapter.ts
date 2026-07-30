import { randomUUID } from 'node:crypto'
import { chmod, link, open, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { DeploymentEvidence, EvidencePort } from './ports.js'

const forbiddenEvidenceKeyPattern =
  /(api.?key|authorization|cookie|credential|database.?url|header|password|redis.?url|secret|token)/iu
const forbiddenEnvironmentKeys = new Set([
  'dokployApplicationEnvironment',
  'dokployPreviousApplicationEnvironment',
])

/** Stable evidence publication failure codes. */
export type EvidenceFileErrorCode =
  | 'EVIDENCE_EXISTS'
  | 'EVIDENCE_FORBIDDEN_KEY'
  | 'EVIDENCE_SERIALIZATION'
  | 'EVIDENCE_WRITE'
  | 'EVIDENCE_PUBLICATION'
  | 'EVIDENCE_CLEANUP'

/** Minimal writable file handle used by evidence publication. */
export interface EvidenceWritableFile {
  writeFile(data: string, encoding: BufferEncoding): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

/** Injectable filesystem operations for atomic evidence publication. */
export interface EvidenceFileAdapterOptions {
  readonly linkImplementation?: (
    existingPath: string,
    newPath: string,
  ) => Promise<void>
  readonly writeImplementation?: (
    file: EvidenceWritableFile,
    data: string,
  ) => Promise<void>
}

/**
 * Redacted atomic evidence publication failure.
 */
export class EvidenceFileError extends Error {
  readonly code: EvidenceFileErrorCode

  /**
   * Creates an evidence error containing a stable code only.
   *
   * @param code - Stable publication failure code.
   */
  constructor(code: EvidenceFileErrorCode) {
    super(`Deployment evidence publication failed: ${code}`)
    this.name = 'EvidenceFileError'
    this.code = code
  }

  /** Returns a serialization without paths, values or filesystem messages. */
  toJSON(): Readonly<{ name: string; message: string; code: string }> {
    return Object.freeze({
      name: this.name,
      message: this.message,
      code: this.code,
    })
  }
}

function isNodeErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === code
  )
}

function assertAllowedKeys(value: unknown, visited: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null) return
  if (visited.has(value)) return
  visited.add(value)

  if (Array.isArray(value)) {
    for (const item of value) assertAllowedKeys(item, visited)
    return
  }

  for (const [key, child] of Object.entries(value)) {
    if (
      forbiddenEvidenceKeyPattern.test(key) ||
      forbiddenEnvironmentKeys.has(key)
    ) {
      throw new EvidenceFileError('EVIDENCE_FORBIDDEN_KEY')
    }
    assertAllowedKeys(child, visited)
  }
}

function serializeEvidence(evidence: DeploymentEvidence): string {
  assertAllowedKeys(evidence, new WeakSet())
  try {
    const json = JSON.stringify(evidence, null, 2)
    if (json === undefined) {
      throw new EvidenceFileError('EVIDENCE_SERIALIZATION')
    }
    return `${json}\n`
  } catch (error) {
    if (error instanceof EvidenceFileError) throw error
    throw new EvidenceFileError('EVIDENCE_SERIALIZATION')
  }
}

function publicationError(
  error: unknown,
  stage: 'open' | 'write' | 'sync' | 'close' | 'link',
): EvidenceFileError {
  if (stage === 'link' && isNodeErrorWithCode(error, 'EEXIST')) {
    return new EvidenceFileError('EVIDENCE_EXISTS')
  }
  if (stage === 'link') {
    return new EvidenceFileError('EVIDENCE_PUBLICATION')
  }
  return new EvidenceFileError('EVIDENCE_WRITE')
}

/**
 * Publishes redacted evidence atomically without replacing an existing path.
 *
 * @remarks
 * A mode-0600 temporary sibling is written and synced before a same-directory
 * hard link performs the atomic no-overwrite publication.
 */
export class EvidenceFileAdapter implements EvidencePort {
  readonly #link: (existingPath: string, newPath: string) => Promise<void>
  readonly #write: (file: EvidenceWritableFile, data: string) => Promise<void>

  /**
   * Creates the adapter with injectable publication and write operations.
   *
   * @param options - Optional filesystem seams used by contract tests.
   */
  constructor(options: EvidenceFileAdapterOptions = {}) {
    this.#link = options.linkImplementation ?? link
    this.#write =
      options.writeImplementation ??
      ((file, data) => file.writeFile(data, 'utf8'))
  }

  /**
   * Securely publishes one evidence document.
   *
   * @param path - Caller-selected destination that must not already exist.
   * @param evidence - Final secret-free evidence projection.
   * @throws EvidenceFileError for forbidden keys, serialization, write,
   * publication or cleanup failure.
   */
  async write(path: string, evidence: DeploymentEvidence): Promise<void> {
    const serialized = serializeEvidence(evidence)
    const destinationPath = resolve(path)
    const temporaryPath = join(
      dirname(destinationPath),
      `.deployment-evidence-${randomUUID()}.tmp`,
    )
    let file: FileHandle | undefined
    let stage: 'open' | 'write' | 'sync' | 'close' | 'link' = 'open'
    let failure: EvidenceFileError | undefined

    try {
      file = await open(temporaryPath, 'wx', 0o600)
      await chmod(temporaryPath, 0o600)
      stage = 'write'
      await this.#write(file, serialized)
      stage = 'sync'
      await file.sync()
      stage = 'close'
      await file.close()
      file = undefined
      stage = 'link'
      await this.#link(temporaryPath, destinationPath)
    } catch (error) {
      failure =
        error instanceof EvidenceFileError
          ? error
          : publicationError(error, stage)
    } finally {
      if (file !== undefined) {
        try {
          await file.close()
        } catch {
          failure ??= new EvidenceFileError('EVIDENCE_CLEANUP')
        }
      }
      try {
        await unlink(temporaryPath)
      } catch (error) {
        if (!isNodeErrorWithCode(error, 'ENOENT')) {
          failure ??= new EvidenceFileError('EVIDENCE_CLEANUP')
        }
      }
    }

    if (failure !== undefined) throw failure
  }
}
