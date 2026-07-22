import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import openApiDiff from 'openapi-diff'

import {
  readBreakingBase,
  resolveBreakingBaseSource,
  type BreakingBaseSource,
} from './read-breaking-base'

function diffContractText(
  source: string,
  destination: string,
  sourceLocation: string,
  destinationLocation: string,
): ReturnType<typeof openApiDiff.diffSpecs> {
  return openApiDiff.diffSpecs({
    sourceSpec: {
      content: source,
      location: sourceLocation,
      format: 'openapi3',
    },
    destinationSpec: {
      content: destination,
      location: destinationLocation,
      format: 'openapi3',
    },
  })
}

/**
 * Classifies changes between two JSON-compatible OpenAPI documents.
 *
 * @param source - Base contract exposed to existing consumers.
 * @param destination - Candidate replacement contract.
 */
export function diffOpenApiContracts(
  source: unknown,
  destination: unknown,
): ReturnType<typeof openApiDiff.diffSpecs> {
  return diffContractText(
    JSON.stringify(source),
    JSON.stringify(destination),
    'source.json',
    'destination.json',
  )
}

/**
 * Rejects breaking and unclassified OpenAPI differences.
 *
 * @param source - Base contract exposed to existing consumers.
 * @param destination - Candidate replacement contract.
 */
export async function assertNoBreakingOpenApiChanges(
  source: unknown,
  destination: unknown,
): Promise<void> {
  const result = await diffOpenApiContracts(source, destination)
  if (
    result.breakingDifferencesFound ||
    result.unclassifiedDifferences.length > 0
  ) {
    const breakingCount = result.breakingDifferencesFound
      ? result.breakingDifferences.length
      : 0
    const unclassifiedCodes = result.unclassifiedDifferences
      .map((difference) => difference.code)
      .sort()
    throw new Error(
      `Breaking OpenAPI changes detected: breaking=${breakingCount}, unclassified=${unclassifiedCodes.join(',') || 'none'}`,
    )
  }
}

/**
 * Compares the canonical artifact with one explicit materialized base source.
 *
 * @param source - Explicit file or Git ref base source.
 * @param currentArtifactPath - Candidate canonical artifact path.
 */
export async function checkBreakingOpenApi(
  source: BreakingBaseSource,
  currentArtifactPath = 'docs/api/openapi.json',
): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'openapi-breaking-'))
  await chmod(temporaryDirectory, 0o700)
  try {
    const [base, current] = await Promise.all([
      readBreakingBase(source),
      readFile(resolve(currentArtifactPath), 'utf8'),
    ])
    const basePath = join(temporaryDirectory, 'base.json')
    const currentPath = join(temporaryDirectory, 'current.json')
    await Promise.all([
      writeFile(basePath, base, { encoding: 'utf8', mode: 0o600 }),
      writeFile(currentPath, current, { encoding: 'utf8', mode: 0o600 }),
    ])
    const result = await diffContractText(base, current, basePath, currentPath)
    if (
      result.breakingDifferencesFound ||
      result.unclassifiedDifferences.length > 0
    ) {
      const breakingCount = result.breakingDifferencesFound
        ? result.breakingDifferences.length
        : 0
      const unclassifiedCodes = result.unclassifiedDifferences
        .map((difference) => difference.code)
        .sort()
      throw new Error(
        `Breaking OpenAPI changes detected: breaking=${breakingCount}, unclassified=${unclassifiedCodes.join(',') || 'none'}`,
      )
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

async function main(): Promise<void> {
  const source = resolveBreakingBaseSource(process.argv.slice(2))
  await checkBreakingOpenApi(source)
  process.stdout.write('OpenAPI breaking changes: none\n')
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
