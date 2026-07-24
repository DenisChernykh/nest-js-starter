import { execFile } from 'node:child_process'
import { resolve } from 'node:path'

import { validateGhcrImage } from './write-image-evidence'

const fullRevision = /^[0-9a-f]{40}$/u
const missingTagResponse = /\b(?:manifest unknown|name unknown|not found)\b/iu

/** Describes the bounded argv-only Buildx adapter used by the tag guard. */
export type ImageTagInspectCommand = (
  file: string,
  arguments_: readonly string[],
) => Promise<{ readonly stdout: string }>

/** Identifies the exact GHCR SHA tag that must still be unpublished. */
export interface ImageTagInput {
  readonly image: string
  readonly revision: string
}

function runBuildxInspect(
  file: string,
  arguments_: readonly string[],
): Promise<{ readonly stdout: string }> {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(
      file,
      [...arguments_],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 120_000,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          rejectCommand(
            new Error(stderr || error.message, {
              cause: error,
            }),
          )
          return
        }
        resolveCommand({ stdout })
      },
    )
  })
}

/**
 * Fails before publication unless the registry confirms that a SHA tag is absent.
 *
 * @param input - Lowercase GHCR image and exact 40-character Git revision.
 * @param command - Injectable read-only Buildx adapter for deterministic tests.
 * @throws Error for invalid input, an existing tag or an inconclusive registry read.
 */
export async function assertImageTagAvailable(
  input: ImageTagInput,
  command: ImageTagInspectCommand = runBuildxInspect,
): Promise<void> {
  try {
    validateGhcrImage(input.image)
  } catch (error: unknown) {
    throw new Error('Invalid image tag input', { cause: error })
  }
  if (!fullRevision.test(input.revision)) {
    throw new Error('Invalid image tag input')
  }

  try {
    await command('docker', [
      'buildx',
      'imagetools',
      'inspect',
      `${input.image}:${input.revision}`,
      '--format',
      '{{json .Manifest}}',
    ])
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''
    if (missingTagResponse.test(message)) return
    throw new Error('Image tag availability check failed', { cause: error })
  }

  throw new Error('Image SHA tag already exists')
}

function readOption(arguments_: readonly string[], name: string): string {
  const index = arguments_.indexOf(name)
  const value = arguments_[index + 1]
  if (index < 0 || value === undefined || value.startsWith('--')) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function parseCliOptions(arguments_: readonly string[]): ImageTagInput {
  if (arguments_.length !== 4) {
    throw new Error(
      'Usage: assert-image-tag-available --image <ghcr-image> --revision <40-hex>',
    )
  }
  return {
    image: readOption(arguments_, '--image'),
    revision: readOption(arguments_, '--revision'),
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(
    process.argv.slice(2).filter((value) => value !== '--'),
  )
  await assertImageTagAvailable(options)
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename)
) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Image tag guard failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
