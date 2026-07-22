import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { validateDigestReference } from './write-image-evidence'

/** Describes the bounded argv-only command adapter used for registry reads. */
export type RegistryInspectCommand = (
  file: string,
  arguments_: readonly string[],
) => Promise<{ readonly stdout: string }>

/** Contains registry-attached SPDX and SLSA documents for one image digest. */
export interface RegistryAttestations {
  readonly sbom: Readonly<Record<string, unknown>>
  readonly provenance: Readonly<Record<string, unknown>>
}

interface CliOptions {
  readonly provenanceOutputPath: string
  readonly reference: string
  readonly sbomOutputPath: string
}

function isNonEmptyRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  )
}

function runDockerInspect(
  file: string,
  arguments_: readonly string[],
): Promise<{ readonly stdout: string }> {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(
      file,
      [...arguments_],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 120_000,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          rejectCommand(
            new Error(
              `Registry attestation read failed: ${stderr || error.message}`,
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

function parseAttestation(source: string): Readonly<Record<string, unknown>> {
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch (error: unknown) {
    throw new Error('Invalid registry attestation', { cause: error })
  }
  if (!isNonEmptyRecord(value)) {
    throw new Error('Invalid registry attestation')
  }
  return value
}

/**
 * Reads Buildx-attached SPDX and SLSA payloads from one immutable image.
 *
 * @param reference - Canonical lowercase GHCR digest reference.
 * @param command - Injectable argv-only command adapter for deterministic tests.
 * @returns Validated non-empty attestation documents.
 * @throws Error on mutable references, command failure or malformed documents.
 */
export async function readRegistryAttestations(
  reference: string,
  command: RegistryInspectCommand = runDockerInspect,
): Promise<RegistryAttestations> {
  validateDigestReference(reference)
  const baseArguments = [
    'buildx',
    'imagetools',
    'inspect',
    reference,
    '--format',
  ]
  const [sbomResult, provenanceResult] = await Promise.all([
    command('docker', [...baseArguments, '{{json .SBOM.SPDX}}']),
    command('docker', [...baseArguments, '{{json .Provenance.SLSA}}']),
  ])
  return {
    sbom: parseAttestation(sbomResult.stdout),
    provenance: parseAttestation(provenanceResult.stdout),
  }
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
  if (arguments_.length !== 6) {
    throw new Error(
      'Usage: read-registry-attestations --reference <digest-reference> --sbom-output <path> --provenance-output <path>',
    )
  }
  return {
    reference: readOption(arguments_, '--reference'),
    sbomOutputPath: readOption(arguments_, '--sbom-output'),
    provenanceOutputPath: readOption(arguments_, '--provenance-output'),
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))
  const attestations = await readRegistryAttestations(options.reference)
  await Promise.all([
    writeFile(
      resolve(options.sbomOutputPath),
      `${JSON.stringify(attestations.sbom, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      resolve(options.provenanceOutputPath),
      `${JSON.stringify(attestations.provenance, null, 2)}\n`,
      'utf8',
    ),
  ])
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename)
) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : 'Registry attestation read failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
