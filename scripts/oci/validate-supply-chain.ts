import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { parseDocument } from 'yaml'

const digestReference =
  /^[a-z0-9][a-z0-9._/-]*:[a-z0-9._-]+@sha256:[0-9a-f]{64}$/u
const fullCommitSha = /^[0-9a-f]{40}$/u
const stableActionTag = /^v\d+\.\d+\.\d+$/u
const externalActionReference = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@(.+)$/u

type UnknownRecord = Record<string, unknown>

/** Identifies the reviewed stable tag and immutable commit for one action. */
export interface ActionPin {
  readonly tag: string
  readonly sha: string
}

/** Defines every immutable external reference accepted by the OCI workflows. */
export interface OciPins {
  readonly schemaVersion: 1
  readonly dockerfileFrontend: string
  readonly nodeRuntime: string
  readonly actions: Readonly<Record<string, ActionPin>>
}

/**
 * Supplies parsed project metadata and optional build/workflow sources.
 *
 * @remarks Optional future-slice files are validated when present so the same
 * validator can be introduced before Docker and workflow definitions exist.
 */
export interface SupplyChainFilesInput {
  readonly dockerfile?: string
  readonly packageJson: unknown
  readonly pins: OciPins
  readonly workflows?: Readonly<Record<string, string>>
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(
  value: UnknownRecord,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  )
}

function parsePins(value: unknown): OciPins {
  const issues: string[] = []
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'actions',
      'dockerfileFrontend',
      'nodeRuntime',
      'schemaVersion',
    ])
  ) {
    throw new Error('Invalid OCI pins: root contract')
  }

  if (value['schemaVersion'] !== 1) issues.push('schemaVersion')
  if (
    typeof value['dockerfileFrontend'] !== 'string' ||
    !digestReference.test(value['dockerfileFrontend']) ||
    !value['dockerfileFrontend'].startsWith('docker/dockerfile:')
  ) {
    issues.push('dockerfileFrontend')
  }
  if (
    typeof value['nodeRuntime'] !== 'string' ||
    !digestReference.test(value['nodeRuntime']) ||
    !value['nodeRuntime'].startsWith('node:')
  ) {
    issues.push('nodeRuntime')
  }

  const actions = value['actions']
  if (!isRecord(actions) || Object.keys(actions).length === 0) {
    issues.push('actions')
  } else {
    for (const [name, candidate] of Object.entries(actions)) {
      if (
        !externalActionReference.test(`${name}@placeholder`) ||
        !isRecord(candidate) ||
        !hasExactKeys(candidate, ['sha', 'tag']) ||
        typeof candidate['tag'] !== 'string' ||
        !stableActionTag.test(candidate['tag']) ||
        typeof candidate['sha'] !== 'string' ||
        !fullCommitSha.test(candidate['sha'])
      ) {
        issues.push(`actions.${name}`)
      }
    }
  }

  if (issues.length > 0) {
    throw new Error(`Invalid OCI pins: ${issues.sort().join(', ')}`)
  }
  return value as unknown as OciPins
}

/**
 * Reads and strictly validates the version-one immutable pin document.
 *
 * @param path - Absolute or working-directory-relative JSON file path.
 * @returns The validated pin contract without consulting mutable registries.
 * @throws Error when JSON syntax, fields, tags, digests or SHAs are invalid.
 */
export async function readOciPins(path: string): Promise<OciPins> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(resolve(path), 'utf8')) as unknown
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'unknown error'
    throw new Error(`Invalid OCI pins: ${detail}`, { cause: error })
  }
  return parsePins(value)
}

function validatePackageJson(packageJson: unknown, issues: string[]): void {
  const devDependencies = isRecord(packageJson)
    ? packageJson['devDependencies']
    : undefined
  const yamlVersion = isRecord(devDependencies)
    ? devDependencies['yaml']
    : undefined
  if (yamlVersion !== '2.9.0') {
    issues.push('yaml dependency must be exact stable 2.9.0')
  }
}

function validateDockerfile(
  source: string,
  pins: OciPins,
  issues: string[],
): void {
  const lines = source.split(/\r?\n/u)
  if (lines[0] !== `# syntax=${pins.dockerfileFrontend}`) {
    issues.push('Dockerfile frontend must match the approved digest')
  }

  const argumentsByName = new Map<string, string>()
  for (const line of lines) {
    const argument = /^ARG\s+([A-Z0-9_]+)=(\S+)\s*$/u.exec(line)
    if (argument?.[1] !== undefined && argument[2] !== undefined) {
      argumentsByName.set(argument[1], argument[2])
    }
  }

  const fromReferences = lines
    .map((line) => /^FROM\s+(\S+)(?:\s+AS\s+\S+)?\s*$/iu.exec(line)?.[1])
    .filter((reference): reference is string => reference !== undefined)
  if (fromReferences.length === 0) {
    issues.push('Dockerfile must define a base image')
  }

  for (const reference of fromReferences) {
    const variable = /^\$\{([A-Z0-9_]+)\}$/u.exec(reference)?.[1]
    const resolvedReference =
      variable === undefined ? reference : argumentsByName.get(variable)
    if (
      resolvedReference === undefined ||
      !digestReference.test(resolvedReference) ||
      resolvedReference !== pins.nodeRuntime
    ) {
      issues.push('Dockerfile base image must be digest-pinned')
    }
  }
}

function parseWorkflow(path: string, source: string): UnknownRecord {
  const document = parseDocument(source, { uniqueKeys: true })
  if (document.errors.length > 0) {
    throw new Error(
      `Invalid workflow ${path}: ${document.errors.map((error) => error.message).join('; ')}`,
    )
  }
  const value = document.toJS({ maxAliasCount: 50 }) as unknown
  if (!isRecord(value)) throw new Error(`Invalid workflow ${path}: root object`)
  return value
}

function grantsWrite(value: unknown): boolean {
  if (typeof value === 'string') return value === 'write-all'
  return (
    isRecord(value) &&
    Object.values(value).some(
      (permission) =>
        typeof permission === 'string' && permission.endsWith('write'),
    )
  )
}

function validateBuildPublication(step: UnknownRecord, issues: string[]): void {
  const withInputs = step['with']
  if (!isRecord(withInputs)) return
  const pushes = withInputs['push'] === true || withInputs['push'] === 'true'
  if (!pushes) return

  const tags = withInputs['tags']
  const tagLines =
    typeof tags === 'string'
      ? tags
          .split(/\r?\n/u)
          .map((tag) => tag.trim())
          .filter(Boolean)
      : []
  if (tagLines.length !== 1 || !tagLines[0]?.endsWith(':${{ github.sha }}')) {
    issues.push('published image tag must use github.sha')
  }
  if (
    withInputs['sbom'] !== true ||
    withInputs['provenance'] !== 'mode=max,version=v1'
  ) {
    issues.push('published image must include SBOM and max provenance')
  }
}

function validateWorkflow(
  path: string,
  source: string,
  pins: OciPins,
  issues: string[],
): void {
  const workflow = parseWorkflow(path, source)
  const triggers = workflow['on']
  if (isRecord(triggers) && 'pull_request_target' in triggers) {
    issues.push('pull_request_target is forbidden')
  }

  const isPullRequest = isRecord(triggers) && 'pull_request' in triggers
  if (isPullRequest && grantsWrite(workflow['permissions'])) {
    issues.push('pull request workflow must not grant write permissions')
  }

  const jobs = workflow['jobs']
  if (!isRecord(jobs)) return
  for (const job of Object.values(jobs)) {
    if (!isRecord(job)) continue
    if (isPullRequest && grantsWrite(job['permissions'])) {
      issues.push('pull request workflow must not grant write permissions')
    }
    if (!Array.isArray(job['steps'])) continue
    for (const step of job['steps']) {
      if (!isRecord(step) || typeof step['uses'] !== 'string') continue
      const reference = step['uses']
      if (reference.startsWith('./')) continue
      const match = externalActionReference.exec(reference)
      const approved =
        match?.[1] === undefined ? undefined : pins.actions[match[1]]
      if (
        match?.[2] === undefined ||
        !fullCommitSha.test(match[2]) ||
        approved?.sha !== match[2]
      ) {
        issues.push('external action must use an approved 40-character SHA')
        continue
      }
      if (match[1] === 'docker/build-push-action') {
        validateBuildPublication(step, issues)
      }
    }
  }
}

/**
 * Validates local dependency, Docker and GitHub workflow supply-chain policy.
 *
 * @param input - Parsed package/pins plus optional raw future-slice files.
 * @throws Error containing every deterministic policy violation found.
 */
export function validateSupplyChainFiles(input: SupplyChainFilesInput): void {
  const pins = parsePins(input.pins)
  const issues: string[] = []
  validatePackageJson(input.packageJson, issues)
  if (input.dockerfile !== undefined) {
    validateDockerfile(input.dockerfile, pins, issues)
  }
  for (const [path, source] of Object.entries(input.workflows ?? {})) {
    validateWorkflow(path, source, pins, issues)
  }
  if (issues.length > 0) {
    throw new Error(
      `Invalid supply-chain files: ${[...new Set(issues)].join('; ')}`,
    )
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isRecord(error) && error['code'] === 'ENOENT') return undefined
    throw error
  }
}

async function readWorkflows(
  directory: string,
): Promise<Record<string, string>> {
  let names: string[]
  try {
    names = (await readdir(directory)).filter((name) => /\.ya?ml$/u.test(name))
  } catch (error: unknown) {
    if (isRecord(error) && error['code'] === 'ENOENT') return {}
    throw error
  }
  const entries = await Promise.all(
    names
      .sort()
      .map(
        async (name) =>
          [name, await readFile(join(directory, name), 'utf8')] as const,
      ),
  )
  return Object.fromEntries(entries)
}

async function main(): Promise<void> {
  const projectRoot = process.cwd()
  const pins = await readOciPins(join(projectRoot, 'scripts/oci/oci-pins.json'))
  const packageJson = JSON.parse(
    await readFile(join(projectRoot, 'package.json'), 'utf8'),
  ) as unknown
  const [dockerfile, workflows] = await Promise.all([
    readOptionalFile(join(projectRoot, 'Dockerfile')),
    readWorkflows(join(projectRoot, '.github/workflows')),
  ])
  validateSupplyChainFiles({
    ...(dockerfile === undefined ? {} : { dockerfile }),
    packageJson,
    pins,
    workflows,
  })
  process.stdout.write('OCI supply-chain files: valid\n')
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename)
) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'OCI validation failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
