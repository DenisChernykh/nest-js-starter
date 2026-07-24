import { execFile } from 'node:child_process'
import { resolve } from 'node:path'

import {
  createDigestReference,
  validateGhcrImage,
} from './write-image-evidence'

const fullRevision = /^[0-9a-f]{40}$/u
const sha256Digest = /^sha256:[0-9a-f]{64}$/u

/** Describes the bounded argv-only Buildx adapter used by the resolver. */
export type ImageInspectCommand = (
  file: string,
  arguments_: readonly string[],
) => Promise<{ readonly stdout: string }>

/** Supplies the canonical image name and exact Git revision to resolve. */
export interface ImageResolverInput {
  readonly image: string
  readonly revision: string
}

/** Captures a verified existing SHA tag and its immutable digest reference. */
export interface ResolvedImage {
  readonly image: string
  readonly digest: `sha256:${string}`
  readonly reference: string
  readonly revision: string
}

interface CliOptions extends ImageResolverInput {
  readonly json: boolean
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
            new Error(
              `Existing image inspection failed: ${stderr || error.message}`,
              {
                cause: error,
              },
            ),
          )
          return
        }
        resolveCommand({ stdout })
      },
    )
  })
}

function parseJson(source: string, message: string): unknown {
  try {
    return JSON.parse(source) as unknown
  } catch (error: unknown) {
    throw new Error(message, { cause: error })
  }
}

function parseManifestDigest(source: string): `sha256:${string}` {
  const manifest = parseJson(source, 'Invalid registry manifest')
  const digest = isRecord(manifest) ? manifest['digest'] : undefined
  if (typeof digest !== 'string' || !sha256Digest.test(digest)) {
    throw new Error('Invalid registry manifest')
  }
  return digest as `sha256:${string}`
}

function readRevisionLabel(source: string): string | undefined {
  const imageConfig = parseJson(source, 'Invalid registry image config')
  const config = isRecord(imageConfig) ? imageConfig['config'] : undefined
  const labels = isRecord(config) ? config['Labels'] : undefined
  const revision = isRecord(labels)
    ? labels['org.opencontainers.image.revision']
    : undefined
  return typeof revision === 'string' ? revision : undefined
}

/**
 * Resolves an existing exact SHA tag and verifies its embedded revision label.
 *
 * @param input - Lowercase GHCR image and requested 40-character Git SHA.
 * @param command - Injectable read-only Buildx command adapter.
 * @returns The verified tag digest and canonical immutable reference.
 * @throws Error when input, registry output or the OCI revision label is invalid.
 */
export async function resolveExistingImage(
  input: ImageResolverInput,
  command: ImageInspectCommand = runBuildxInspect,
): Promise<ResolvedImage> {
  try {
    validateGhcrImage(input.image)
  } catch (error: unknown) {
    throw new Error('Invalid image resolver input', { cause: error })
  }
  if (!fullRevision.test(input.revision)) {
    throw new Error('Invalid image resolver input')
  }

  const tagReference = `${input.image}:${input.revision}`
  let manifestResult: { readonly stdout: string }
  try {
    manifestResult = await command('docker', [
      'buildx',
      'imagetools',
      'inspect',
      tagReference,
      '--format',
      '{{json .Manifest}}',
    ])
  } catch (error: unknown) {
    throw new Error('Existing image inspection failed', { cause: error })
  }
  const digest = parseManifestDigest(manifestResult.stdout)
  const reference = createDigestReference(input.image, digest)

  let imageResult: { readonly stdout: string }
  try {
    imageResult = await command('docker', [
      'buildx',
      'imagetools',
      'inspect',
      reference,
      '--format',
      '{{json .Image}}',
    ])
  } catch (error: unknown) {
    throw new Error('Existing image inspection failed', { cause: error })
  }
  if (readRevisionLabel(imageResult.stdout) !== input.revision) {
    throw new Error('Image revision label does not match requested revision')
  }

  return {
    image: input.image,
    digest,
    reference,
    revision: input.revision,
  }
}

/**
 * Serializes a verified image for human or workflow composition.
 *
 * @param resolvedImage - Result returned by `resolveExistingImage`.
 * @param json - Whether to emit a compact machine-readable object.
 * @returns Exactly one newline-terminated stdout record.
 * @throws Error when the resolved object has been altered.
 */
export function serializeResolvedImage(
  resolvedImage: ResolvedImage,
  json: boolean,
): string {
  if (
    !fullRevision.test(resolvedImage.revision) ||
    createDigestReference(resolvedImage.image, resolvedImage.digest) !==
      resolvedImage.reference
  ) {
    throw new Error('Invalid resolved image')
  }
  return json
    ? `${JSON.stringify(resolvedImage)}\n`
    : `${resolvedImage.reference}\n`
}

function readOption(arguments_: readonly string[], name: string): string {
  const index = arguments_.indexOf(name)
  const value = arguments_[index + 1]
  if (index < 0 || value === undefined || value.startsWith('--')) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

function parseCliOptions(arguments_: readonly string[]): CliOptions {
  const json = arguments_.includes('--json')
  if (arguments_.length !== (json ? 5 : 4)) {
    throw new Error(
      'Usage: oci:resolve -- --image <ghcr-image> --revision <40-hex> [--json]',
    )
  }
  return {
    image: readOption(arguments_, '--image'),
    revision: readOption(arguments_, '--revision'),
    json,
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(
    process.argv.slice(2).filter((value) => value !== '--'),
  )
  const resolvedImage = await resolveExistingImage(options)
  process.stdout.write(serializeResolvedImage(resolvedImage, options.json))
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename)
) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Image resolution failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
