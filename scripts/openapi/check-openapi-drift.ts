import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { generateOpenApiArtifact } from '@/bootstrap/contracts/generate-openapi'

/**
 * Requires committed and generated OpenAPI artifacts to match byte-for-byte.
 *
 * @param committedArtifact - UTF-8 text read from the committed artifact.
 * @param generatedArtifact - Fresh canonical UTF-8 generator output.
 * @throws Error when any byte differs.
 */
export function assertOpenApiArtifactBytes(
  committedArtifact: string,
  generatedArtifact: string,
): void {
  if (committedArtifact !== generatedArtifact) {
    throw new Error('OpenAPI artifact drift detected; regenerate the contract')
  }
}

/**
 * Generates the current contract and compares it with one committed file.
 *
 * @param artifactPath - Repository-relative or absolute canonical artifact.
 */
export async function checkOpenApiDrift(
  artifactPath = 'docs/api/openapi.json',
): Promise<void> {
  const [committedArtifact, generatedArtifact] = await Promise.all([
    readFile(resolve(artifactPath), 'utf8'),
    generateOpenApiArtifact(),
  ])
  assertOpenApiArtifactBytes(committedArtifact, generatedArtifact)
}

async function main(): Promise<void> {
  await checkOpenApiDrift()
  process.stdout.write('OpenAPI artifact: current\n')
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename)
) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'OpenAPI failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
