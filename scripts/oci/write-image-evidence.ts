import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const githubRepository =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/u
const ghcrImage =
  /^ghcr\.io\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u
const sha256Digest = /^sha256:[0-9a-f]{64}$/u
const fullRevision = /^[0-9a-f]{40}$/u
const sha256Hex = /^[0-9a-f]{64}$/u

/** Records the immutable image identity and matching public API contract. */
export interface ImageEvidence {
  readonly schemaVersion: 1
  readonly image: string
  readonly digest: `sha256:${string}`
  readonly reference: string
  readonly revision: string
  readonly openapiSha256: string
}

/** Supplies validated public build outputs used to create image evidence. */
export interface ImageEvidenceInput {
  readonly image: string
  readonly digest: string
  readonly revision: string
  readonly openapi: string | Uint8Array
}

interface CliOptions {
  readonly digest: string
  readonly image: string
  readonly openapiPath: string
  readonly outputPath: string
  readonly revision: string
}

/**
 * Converts a GitHub `owner/repository` identity to its canonical GHCR name.
 *
 * @param repository - GitHub repository identity without a registry prefix.
 * @returns A lowercase, untagged `ghcr.io/owner/repository` image name.
 * @throws Error when the repository contains a tag, digest or unsafe segment.
 */
export function normalizeGhcrImage(repository: string): string {
  if (!githubRepository.test(repository)) {
    throw new Error('Invalid GitHub repository')
  }
  const image = `ghcr.io/${repository.toLowerCase()}`
  if (!ghcrImage.test(image)) throw new Error('Invalid GitHub repository')
  return image
}

/**
 * Combines a canonical GHCR image name with an immutable SHA-256 digest.
 *
 * @param image - Lowercase, untagged GHCR image name.
 * @param digest - OCI manifest digest in `sha256:<64-hex>` form.
 * @returns The canonical digest-only deploy reference.
 * @throws Error when either component is mutable or malformed.
 */
export function createDigestReference(image: string, digest: string): string {
  if (!ghcrImage.test(image) || !sha256Digest.test(digest)) {
    throw new Error('Invalid immutable image input')
  }
  return `${image}@${digest}`
}

/**
 * Validates a complete immutable GHCR image reference.
 *
 * @param reference - Candidate `ghcr.io/owner/repository@sha256:...` value.
 * @returns The unchanged reference after strict validation.
 * @throws Error when a tag or malformed digest is supplied.
 */
export function validateDigestReference(reference: string): string {
  const separator = reference.lastIndexOf('@')
  if (
    separator < 0 ||
    createDigestReference(
      reference.slice(0, separator),
      reference.slice(separator + 1),
    ) !== reference
  ) {
    throw new Error('Invalid immutable image input')
  }
  return reference
}

/**
 * Creates strict evidence for one build-once stage image.
 *
 * @param input - Canonical image, digest, Git revision and OpenAPI bytes.
 * @returns A version-one evidence object with a computed OpenAPI SHA-256.
 * @throws Error when public build identity fields are malformed.
 */
export function createImageEvidence(input: ImageEvidenceInput): ImageEvidence {
  let reference: string
  try {
    reference = createDigestReference(input.image, input.digest)
  } catch (error: unknown) {
    throw new Error('Invalid image evidence input', { cause: error })
  }
  if (!fullRevision.test(input.revision)) {
    throw new Error('Invalid image evidence input')
  }
  const openapiSha256 = createHash('sha256').update(input.openapi).digest('hex')
  return {
    schemaVersion: 1,
    image: input.image,
    digest: input.digest as `sha256:${string}`,
    reference,
    revision: input.revision,
    openapiSha256,
  }
}

/**
 * Serializes image evidence in the stable version-one field order.
 *
 * @param evidence - Evidence previously produced by `createImageEvidence`.
 * @returns Indented deterministic JSON terminated by one newline.
 * @throws Error when an altered or structurally invalid object is supplied.
 */
export function serializeImageEvidence(evidence: ImageEvidence): string {
  if (
    evidence.schemaVersion !== 1 ||
    createDigestReference(evidence.image, evidence.digest) !==
      evidence.reference ||
    !fullRevision.test(evidence.revision) ||
    !sha256Hex.test(evidence.openapiSha256)
  ) {
    throw new Error('Invalid image evidence')
  }
  const canonical: ImageEvidence = {
    schemaVersion: 1,
    image: evidence.image,
    digest: evidence.digest,
    reference: evidence.reference,
    revision: evidence.revision,
    openapiSha256: evidence.openapiSha256,
  }
  return `${JSON.stringify(canonical, null, 2)}\n`
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
  if (arguments_.length !== 10) {
    throw new Error(
      'Usage: write-image-evidence --image <image> --digest <digest> --revision <sha> --openapi <path> --output <path>',
    )
  }
  return {
    image: readOption(arguments_, '--image'),
    digest: readOption(arguments_, '--digest'),
    revision: readOption(arguments_, '--revision'),
    openapiPath: readOption(arguments_, '--openapi'),
    outputPath: readOption(arguments_, '--output'),
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))
  const evidence = createImageEvidence({
    image: options.image,
    digest: options.digest,
    revision: options.revision,
    openapi: await readFile(resolve(options.openapiPath)),
  })
  await writeFile(
    resolve(options.outputPath),
    serializeImageEvidence(evidence),
    'utf8',
  )
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename)
) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Image evidence failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
