import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { createOpenApiClientConfig } from '../../openapi-ts.config'

const canonicalArtifactPath = resolve('docs/api/openapi.json')
const generatedOutputPath = resolve('test/fixtures/openapi-client/.generated')
const consumerFixturePath = resolve('test/fixtures/openapi-client/consumer.ts')
const consumerTsConfigPath = resolve(
  'test/fixtures/openapi-client/tsconfig.json',
)
const sourceHashFileName = '.openapi-source.sha256'
const requiredGeneratedFiles = [
  'index.ts',
  'sdk.gen.ts',
  'types.gen.ts',
  'client/client.gen.ts',
] as const

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

async function listFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(path) : [path]
    }),
  )
  return files.flat().sort()
}

async function protectedSourceSnapshot(): Promise<string> {
  const sourceRoot = resolve('src')
  const sourceFiles = await listFiles(sourceRoot)
  const paths = [canonicalArtifactPath, ...sourceFiles]
  const hash = createHash('sha256')
  for (const path of paths) {
    hash.update(relative(process.cwd(), path))
    hash.update('\0')
    hash.update(await readFile(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function generateClient(output: string): Promise<void> {
  const { createClient } = await import('@hey-api/openapi-ts')
  await createClient(createOpenApiClientConfig(output))
}

function compileGeneratedConsumer(): void {
  const result = spawnSync(
    resolve('node_modules/.bin/tsc'),
    ['--project', consumerTsConfigPath, '--pretty', 'false'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  if (result.status !== 0) {
    const diagnostics = `${result.stdout}${result.stderr}`.trim()
    throw new Error(
      `Generated OpenAPI client TypeScript compilation failed${diagnostics === '' ? '' : `:\n${diagnostics}`}`,
    )
  }
}

/**
 * Verifies that all expected generated files exist and match the current spec.
 *
 * @param outputDirectory - Disposable Hey API output directory.
 * @param expectedSourceHash - SHA-256 of the canonical OpenAPI input bytes.
 */
export async function assertGeneratedClientOutput(
  outputDirectory: string,
  expectedSourceHash: string,
): Promise<void> {
  try {
    await Promise.all(
      requiredGeneratedFiles.map((file) => access(join(outputDirectory, file))),
    )
  } catch {
    throw new Error('Generated OpenAPI client output is missing')
  }

  let sourceHash: string
  try {
    sourceHash = (
      await readFile(join(outputDirectory, sourceHashFileName), 'utf8')
    ).trim()
  } catch {
    throw new Error('Generated OpenAPI client output is missing')
  }
  if (sourceHash !== expectedSourceHash) {
    throw new Error('Generated OpenAPI client output is stale')
  }
}

/**
 * Generates and compiles the disposable Fetch client against one consumer.
 *
 * @param consumerSource - Optional consumer source used by negative tests.
 */
export async function checkGeneratedClient(
  consumerSource?: string,
): Promise<void> {
  const protectedBefore = await protectedSourceSnapshot()
  const canonicalBytes = await readFile(canonicalArtifactPath)
  const canonicalHash = sha256(canonicalBytes)
  let failure: Error | undefined

  try {
    await rm(generatedOutputPath, { force: true, recursive: true })
    await mkdir(generatedOutputPath, { recursive: true })
    await generateClient(generatedOutputPath)
    await writeFile(
      join(generatedOutputPath, sourceHashFileName),
      `${canonicalHash}\n`,
      { mode: 0o600 },
    )
    await assertGeneratedClientOutput(generatedOutputPath, canonicalHash)
    const source =
      consumerSource ?? (await readFile(consumerFixturePath, 'utf8'))
    await writeFile(join(generatedOutputPath, 'consumer.ts'), source, {
      mode: 0o600,
    })
    compileGeneratedConsumer()
  } catch (error: unknown) {
    failure =
      error instanceof Error
        ? error
        : new Error('Generated OpenAPI client check failed')
  }

  const protectedAfter = await protectedSourceSnapshot()
  await rm(generatedOutputPath, { force: true, recursive: true })
  if (protectedAfter !== protectedBefore) {
    throw new Error('OpenAPI client generation mutated protected source files')
  }
  if (failure !== undefined) {
    throw failure
  }
}

async function main(): Promise<void> {
  await checkGeneratedClient()
  process.stdout.write('Generated OpenAPI Fetch client: valid\n')
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
