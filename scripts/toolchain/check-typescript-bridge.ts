import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'

const EXPECTED_NATIVE_ALIAS = 'npm:typescript@7.0.2'
const EXPECTED_COMPATIBILITY_ALIAS = 'npm:@typescript/typescript6@6.0.2'
const STABLE_VERSION = /^\d+\.\d+\.\d+$/u
const STABLE_ALIAS = /^npm:(?:@[^/]+\/)?[^@]+@\d+\.\d+\.\d+$/u
const COMPATIBILITY_VERSION = /^6\.0\.\d+$/u
const OBSERVABILITY_DEPENDENCY_FAMILY = {
  '@opentelemetry/api': '1.9.1',
  '@opentelemetry/exporter-metrics-otlp-http': '0.220.0',
  '@opentelemetry/exporter-trace-otlp-http': '0.220.0',
  '@opentelemetry/instrumentation-http': '0.220.0',
  '@opentelemetry/instrumentation-pg': '0.72.0',
  '@opentelemetry/instrumentation-redis': '0.68.0',
  '@opentelemetry/resources': '2.9.0',
  '@opentelemetry/sdk-metrics': '2.9.0',
  '@opentelemetry/sdk-node': '0.220.0',
  '@opentelemetry/sdk-trace-base': '2.9.0',
  '@opentelemetry/semantic-conventions': '1.43.0',
  pino: '10.3.1',
} as const
const FORBIDDEN_OBSERVABILITY_DEPENDENCIES = [
  '@opentelemetry/auto-instrumentations-node',
  '@opentelemetry/instrumentation-express',
  'nestjs-pino',
  'pino-http',
  'pino-pretty',
] as const

/**
 * Minimal root manifest fields inspected by the toolchain gate.
 */
export interface TypeScriptBridgeManifest {
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

/**
 * Version evidence produced by the two local compiler binaries and imported API.
 */
export interface TypeScriptBridgeEvidence {
  readonly compatibilityApiVersion: string
  readonly compatibilityCliVersion: string
  readonly nativeCliVersion: string
}

function fail(details: readonly string[]): never {
  throw new Error(`Invalid TypeScript toolchain bridge: ${details.join('; ')}`)
}

function normalizeCliVersion(output: string): string {
  return output.trim().replace(/^Version\s+/u, '')
}

/**
 * Verifies exact stable version specs for every direct dependency.
 *
 * @param manifest - Package manifest dependency sections to inspect.
 * @throws Error when a direct dependency uses a range, tag, URL or prerelease.
 */
export function assertExactStableDirectDependencies(
  manifest: TypeScriptBridgeManifest,
): void {
  const invalidSpecs = [
    ...Object.entries(manifest.dependencies ?? {}),
    ...Object.entries(manifest.devDependencies ?? {}),
  ].filter(([, spec]) => !STABLE_VERSION.test(spec) && !STABLE_ALIAS.test(spec))

  if (invalidSpecs.length > 0) {
    throw new Error(
      `Direct dependencies must use exact stable versions: ${invalidSpecs
        .map(([name, spec]) => `${name}=${spec}`)
        .join(', ')}`,
    )
  }
}

/**
 * Verifies the exact reviewed logging and OpenTelemetry dependency family.
 *
 * @param manifest - Package manifest dependency sections to inspect.
 * @param expectedFamily - Exact registry snapshot approved for the slice.
 * @throws Error when a package is missing, mismatched, ranged or forbidden.
 */
export function assertObservabilityDependencyFamily(
  manifest: TypeScriptBridgeManifest,
  expectedFamily: Readonly<Record<string, string>>,
): void {
  const directDependencies = {
    ...(manifest.devDependencies ?? {}),
    ...(manifest.dependencies ?? {}),
  }
  const failures: string[] = []

  for (const [packageName, expectedVersion] of Object.entries(expectedFamily)) {
    if (!STABLE_VERSION.test(expectedVersion)) {
      failures.push(`${packageName} expected pin is not exact stable`)
      continue
    }

    const actualVersion = manifest.dependencies?.[packageName]
    if (actualVersion !== expectedVersion) {
      failures.push(
        `${packageName} must equal ${expectedVersion}, received ${actualVersion ?? 'missing'}`,
      )
    }
  }

  for (const packageName of FORBIDDEN_OBSERVABILITY_DEPENDENCIES) {
    if (packageName in directDependencies) {
      failures.push(`${packageName} is forbidden`)
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Invalid observability dependency family: ${failures.join('; ')}`,
    )
  }
}

/**
 * Verifies the native production compiler and compatibility API wiring.
 *
 * @param manifest - Manifest containing the two reviewed npm aliases.
 * @param evidence - Normalized or raw CLI/API version evidence.
 * @throws Error when aliases are missing/swapped or versions diverge.
 */
export function assertTypeScriptBridge(
  manifest: TypeScriptBridgeManifest,
  evidence: TypeScriptBridgeEvidence,
): void {
  const nativeAlias = manifest.devDependencies?.['@typescript/native']
  const compatibilityAlias = manifest.devDependencies?.typescript
  const nativeVersion = normalizeCliVersion(evidence.nativeCliVersion)
  const compatibilityCliVersion = normalizeCliVersion(
    evidence.compatibilityCliVersion,
  )
  const compatibilityApiVersion = normalizeCliVersion(
    evidence.compatibilityApiVersion,
  )
  const failures: string[] = []

  if (nativeAlias !== EXPECTED_NATIVE_ALIAS) {
    failures.push(`@typescript/native must equal ${EXPECTED_NATIVE_ALIAS}`)
  }
  if (compatibilityAlias !== EXPECTED_COMPATIBILITY_ALIAS) {
    failures.push(`typescript must equal ${EXPECTED_COMPATIBILITY_ALIAS}`)
  }
  if (nativeVersion !== '7.0.2') {
    failures.push('native tsc must be 7.0.2')
  }
  if (!COMPATIBILITY_VERSION.test(compatibilityCliVersion)) {
    failures.push('tsc6 must resolve a 6.0.x version')
  }
  if (compatibilityApiVersion !== compatibilityCliVersion) {
    failures.push('imported TypeScript API must match tsc6')
  }

  if (failures.length > 0) {
    fail(failures)
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function isManifest(value: unknown): value is TypeScriptBridgeManifest {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readPackageVersion(path: string): string {
  const value = readJson(path)
  if (
    value === null ||
    typeof value !== 'object' ||
    !('version' in value) ||
    typeof value.version !== 'string'
  ) {
    throw new Error(`Package metadata has no version: ${path}`)
  }
  return value.version
}

function runVersion(binaryPath: string): string {
  return execFileSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    shell: false,
  })
}

function main(): void {
  const projectRoot = process.cwd()
  const manifestValue = readJson(join(projectRoot, 'package.json'))
  if (!isManifest(manifestValue)) {
    throw new Error('Root package manifest must be an object')
  }

  const nativePackageVersion = readPackageVersion(
    join(projectRoot, 'node_modules/@typescript/native/package.json'),
  )
  const evidence = {
    compatibilityApiVersion: ts.version,
    compatibilityCliVersion: runVersion(
      join(projectRoot, 'node_modules/.bin/tsc6'),
    ),
    nativeCliVersion: runVersion(join(projectRoot, 'node_modules/.bin/tsc')),
  }

  assertExactStableDirectDependencies(manifestValue)
  assertObservabilityDependencyFamily(
    manifestValue,
    OBSERVABILITY_DEPENDENCY_FAMILY,
  )
  assertTypeScriptBridge(manifestValue, evidence)
  if (nativePackageVersion !== '7.0.2') {
    fail(['@typescript/native package metadata must be 7.0.2'])
  }

  process.stdout.write(
    `TypeScript native=${normalizeCliVersion(evidence.nativeCliVersion)} compatibility-cli=${normalizeCliVersion(evidence.compatibilityCliVersion)} compatibility-api=${evidence.compatibilityApiVersion}\n`,
  )
}

if (require.main === module) {
  try {
    main()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
