import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { generateOpenApiArtifact } from '@/bootstrap/contracts/generate-openapi'

/** Parsed CLI arguments for one explicit OpenAPI artifact destination. */
export interface OpenApiWriterArguments {
  readonly outputPath: string
}

/**
 * Parses the strict local OpenAPI writer command line.
 *
 * @param arguments_ - Arguments after the executable and script path.
 * @returns One required explicit output path.
 * @throws Error when arguments are missing, unknown or ambiguous.
 */
export function parseOpenApiWriterArguments(
  arguments_: readonly string[],
): OpenApiWriterArguments {
  const outputPath = arguments_[1]
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== '--output' ||
    outputPath === undefined ||
    outputPath.trim() === ''
  ) {
    throw new Error('OpenAPI output path is required: --output <path>')
  }
  return { outputPath }
}

/**
 * Generates and writes one caller-selected OpenAPI text file.
 *
 * @param outputPath - Explicit artifact path owned by the caller.
 */
export async function writeOpenApiArtifact(outputPath: string): Promise<void> {
  const resolvedOutputPath = resolve(outputPath)
  const artifact = await generateOpenApiArtifact()
  await mkdir(dirname(resolvedOutputPath), { recursive: true })
  await writeFile(resolvedOutputPath, artifact, 'utf8')
}

async function main(): Promise<void> {
  const { outputPath } = parseOpenApiWriterArguments(process.argv.slice(2))
  await writeOpenApiArtifact(outputPath)
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
