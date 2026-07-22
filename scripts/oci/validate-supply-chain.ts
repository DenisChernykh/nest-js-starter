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
  readonly dockerignore?: string
  readonly packageJson: unknown
  readonly pins: OciPins
  readonly workflows?: Readonly<Record<string, string>>
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
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

  const stages = new Set<string>()
  const fromInstructions = lines
    .map((line) => /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/iu.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
  if (fromInstructions.length === 0) {
    issues.push('Dockerfile must define a base image')
  }

  for (const instruction of fromInstructions) {
    const reference = instruction[1]
    if (reference === undefined) continue
    const variable = /^\$\{([A-Z0-9_]+)\}$/u.exec(reference)?.[1]
    const resolvedReference =
      variable === undefined ? reference : argumentsByName.get(variable)
    if (
      resolvedReference === undefined ||
      (!stages.has(resolvedReference.toLowerCase()) &&
        (!digestReference.test(resolvedReference) ||
          resolvedReference !== pins.nodeRuntime))
    ) {
      issues.push('Dockerfile base image must be digest-pinned')
    }
    if (instruction[2] !== undefined) {
      stages.add(instruction[2].toLowerCase())
    }
  }

  if (
    !['dependencies', 'build', 'runtime'].every((stage) => stages.has(stage))
  ) {
    issues.push('Dockerfile must define dependencies, build and runtime stages')
  }
  if (
    !source.includes('corepack pnpm@11.15.1 install --frozen-lockfile') ||
    !source.includes('corepack pnpm@11.15.1 run build') ||
    !source.includes('CI=true corepack pnpm@11.15.1 prune --prod') ||
    !source.includes('corepack install --global pnpm@11.15.1')
  ) {
    issues.push('Dockerfile install/build/prune contract is incomplete')
  }

  const runtimeStart = lines.findIndex((line) =>
    /^FROM\s+\S+\s+AS\s+runtime\s*$/iu.test(line),
  )
  const runtimeSource =
    runtimeStart < 0 ? '' : lines.slice(runtimeStart).join('\n')
  const requiredRuntimeCopies = [
    /\s\/app\/package\.json(?:\s|$)/u,
    /\s\/app\/node_modules(?:\s|$)/u,
    /\s\/app\/dist(?:\s|$)/u,
    /\s\/app\/prisma(?:\s|$)/u,
    /\s\/app\/prisma\.config\.ts(?:\s|$)/u,
  ]
  if (!requiredRuntimeCopies.every((pattern) => pattern.test(runtimeSource))) {
    issues.push('Dockerfile runtime contents are incomplete')
  }

  const requiredMetadata = [
    'ARG BUILD_REVISION',
    'ARG BUILD_SOURCE',
    'ARG BUILD_CREATED',
    'org.opencontainers.image.title="nest-js-starter"',
    'org.opencontainers.image.source="${BUILD_SOURCE}"',
    'org.opencontainers.image.revision="${BUILD_REVISION}"',
    'org.opencontainers.image.created="${BUILD_CREATED}"',
  ]
  if (!requiredMetadata.every((entry) => runtimeSource.includes(entry))) {
    issues.push('Dockerfile OCI metadata contract is incomplete')
  }
  if (
    !runtimeSource.includes('BUILD_REVISION must be 40 lowercase hex') ||
    !runtimeSource.includes('BUILD_SOURCE must be a credential-free HTTPS URL')
  ) {
    issues.push('Dockerfile must validate public metadata inputs during build')
  }
  if (
    !runtimeSource.split(/\r?\n/u).includes('USER node') ||
    !runtimeSource
      .split(/\r?\n/u)
      .includes('CMD ["node", "dist/bootstrap/api/main.js"]')
  ) {
    issues.push('Dockerfile must run as non-root with exec-form API command')
  }
  if (!runtimeSource.includes('pnpm_config_verify_deps_before_run=false')) {
    issues.push('Dockerfile runtime pnpm policy is incomplete')
  }

  const forbiddenRuntimePaths = [
    '/app/src',
    '/app/test',
    '/app/coverage',
    '/app/.env',
    '/app/.git',
  ]
  const runtimeCopies = runtimeSource
    .split(/\r?\n/u)
    .filter((line) => /^COPY\s/iu.test(line))
  if (
    runtimeCopies.some((line) =>
      forbiddenRuntimePaths.some((path) => line.includes(path)),
    )
  ) {
    issues.push('Dockerfile runtime stage must not copy forbidden paths')
  }
}

function validateDockerignore(source: string, issues: string[]): void {
  const entries = new Set(
    source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  )
  const required = ['.git', '.env*', 'node_modules', 'dist', 'coverage', 'test']
  if (!required.every((entry) => entries.has(entry))) {
    issues.push('Docker ignore policy is incomplete')
  }
  if (['src', 'prisma', 'package.json'].some((entry) => entries.has(entry))) {
    issues.push('Docker ignore policy excludes required build inputs')
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

function validatePullRequestWorkflow(
  workflow: UnknownRecord,
  pins: OciPins,
  issues: string[],
): void {
  const triggers = workflow['on']
  const pullRequest = isRecord(triggers) ? triggers['pull_request'] : undefined
  const branches = isRecord(pullRequest) ? pullRequest['branches'] : undefined
  const permissions = workflow['permissions']
  const concurrency = workflow['concurrency']
  const jobs = workflow['jobs']
  const fullGate = isRecord(jobs) ? jobs['full-gate'] : undefined
  const steps = isRecord(fullGate) ? fullGate['steps'] : undefined
  const workflowSteps = isUnknownArray(steps) ? steps : []
  const checkout = workflowSteps.find(
    (step) =>
      isRecord(step) &&
      step['uses'] ===
        `actions/checkout@${pins.actions['actions/checkout']?.sha}`,
  )
  const setupNode = workflowSteps.find(
    (step) =>
      isRecord(step) &&
      step['uses'] ===
        `actions/setup-node@${pins.actions['actions/setup-node']?.sha}`,
  )
  const install = workflowSteps.find(
    (step) =>
      isRecord(step) &&
      step['run'] === 'corepack pnpm@11.15.1 install --frozen-lockfile',
  )
  const check = workflowSteps.find(
    (step) =>
      isRecord(step) && step['run'] === 'corepack pnpm@11.15.1 run check',
  )
  const checkoutWith = isRecord(checkout) ? checkout['with'] : undefined
  const setupWith = isRecord(setupNode) ? setupNode['with'] : undefined
  const checkEnvironment = isRecord(check) ? check['env'] : undefined
  const valid =
    isUnknownArray(branches) &&
    branches.length === 1 &&
    branches[0] === 'stage' &&
    isRecord(permissions) &&
    hasExactKeys(permissions, ['contents']) &&
    permissions['contents'] === 'read' &&
    isRecord(concurrency) &&
    concurrency['group'] ===
      '${{ github.workflow }}-${{ github.event.pull_request.number }}' &&
    concurrency['cancel-in-progress'] === true &&
    isRecord(fullGate) &&
    fullGate['runs-on'] === 'ubuntu-latest' &&
    fullGate['timeout-minutes'] === 45 &&
    isRecord(checkoutWith) &&
    checkoutWith['fetch-depth'] === 0 &&
    isRecord(setupWith) &&
    setupWith['node-version-file'] === '.node-version' &&
    setupWith['check-latest'] === false &&
    install !== undefined &&
    isRecord(checkEnvironment) &&
    checkEnvironment['OPENAPI_BREAKING_BASE_REF'] === 'origin/stage' &&
    checkEnvironment['TESTCONTAINERS_REUSE_ENABLE'] === 'false'
  if (!valid) issues.push('Pull request workflow contract is incomplete')
}

function findStepByAction(
  steps: readonly unknown[],
  action: string,
  pins: OciPins,
): UnknownRecord | undefined {
  const sha = pins.actions[action]?.sha
  return steps.find(
    (step): step is UnknownRecord =>
      isRecord(step) && step['uses'] === `${action}@${sha}`,
  )
}

function splitMultiline(value: unknown): readonly string[] {
  return typeof value === 'string'
    ? value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
    : []
}

function validateStageWorkflow(
  workflow: UnknownRecord,
  pins: OciPins,
  issues: string[],
): void {
  const triggers = workflow['on']
  const push = isRecord(triggers) ? triggers['push'] : undefined
  const branches = isRecord(push) ? push['branches'] : undefined
  const permissions = workflow['permissions']
  const concurrency = workflow['concurrency']
  const jobs = workflow['jobs']
  const publish = isRecord(jobs) ? jobs['publish'] : undefined
  const rawSteps = isRecord(publish) ? publish['steps'] : undefined
  const steps = isUnknownArray(rawSteps) ? rawSteps : []
  const checkout = findStepByAction(steps, 'actions/checkout', pins)
  const setupNode = findStepByAction(steps, 'actions/setup-node', pins)
  const setupBuildx = findStepByAction(
    steps,
    'docker/setup-buildx-action',
    pins,
  )
  const login = findStepByAction(steps, 'docker/login-action', pins)
  const trivy = findStepByAction(steps, 'aquasecurity/trivy-action', pins)
  const upload = findStepByAction(steps, 'actions/upload-artifact', pins)
  const buildSteps = steps.filter(
    (step): step is UnknownRecord =>
      isRecord(step) &&
      step['uses'] ===
        `docker/build-push-action@${pins.actions['docker/build-push-action']?.sha}`,
  )
  const build = buildSteps[0]
  const install = steps.find(
    (step): step is UnknownRecord =>
      isRecord(step) &&
      step['run'] === 'corepack pnpm@11.15.1 install --frozen-lockfile',
  )
  const fullGate = steps.find(
    (step): step is UnknownRecord =>
      isRecord(step) && step['run'] === 'corepack pnpm@11.15.1 run check',
  )
  const imageMetadata = steps.find(
    (step): step is UnknownRecord => isRecord(step) && step['id'] === 'image',
  )
  const attestationReader = steps.find(
    (step): step is UnknownRecord =>
      isRecord(step) &&
      typeof step['run'] === 'string' &&
      step['run'].includes('scripts/oci/read-registry-attestations.ts'),
  )
  const evidenceWriter = steps.find(
    (step): step is UnknownRecord =>
      isRecord(step) &&
      typeof step['run'] === 'string' &&
      step['run'].includes('scripts/oci/write-image-evidence.ts'),
  )
  const checkoutWith = isRecord(checkout) ? checkout['with'] : undefined
  const setupNodeWith = isRecord(setupNode) ? setupNode['with'] : undefined
  const fullGateEnvironment = isRecord(fullGate) ? fullGate['env'] : undefined
  const loginWith = isRecord(login) ? login['with'] : undefined
  const buildWith = isRecord(build) ? build['with'] : undefined
  const trivyWith = isRecord(trivy) ? trivy['with'] : undefined
  const uploadWith = isRecord(upload) ? upload['with'] : undefined
  const imageMetadataSource = isRecord(imageMetadata)
    ? imageMetadata['run']
    : undefined
  const buildArguments = isRecord(buildWith)
    ? splitMultiline(buildWith['build-args'])
    : []
  const uploadedPaths = isRecord(uploadWith)
    ? splitMultiline(uploadWith['path'])
    : []
  const fullGateIndex = steps.indexOf(fullGate)
  const loginIndex = steps.indexOf(login)
  const buildIndex = steps.indexOf(build)

  const valid =
    isUnknownArray(branches) &&
    branches.length === 1 &&
    branches[0] === 'stage' &&
    isRecord(permissions) &&
    hasExactKeys(permissions, ['contents', 'packages']) &&
    permissions['contents'] === 'read' &&
    permissions['packages'] === 'write' &&
    isRecord(concurrency) &&
    concurrency['group'] === 'stage-image-${{ github.ref }}' &&
    concurrency['cancel-in-progress'] === false &&
    isRecord(publish) &&
    publish['runs-on'] === 'ubuntu-latest' &&
    publish['timeout-minutes'] === 60 &&
    !('environment' in publish) &&
    isRecord(checkoutWith) &&
    checkoutWith['fetch-depth'] === 0 &&
    isRecord(setupNodeWith) &&
    setupNodeWith['node-version-file'] === '.node-version' &&
    setupNodeWith['check-latest'] === false &&
    install !== undefined &&
    isRecord(fullGateEnvironment) &&
    fullGateEnvironment['OPENAPI_BREAKING_BASE_REF'] ===
      '${{ github.event.before }}' &&
    fullGateEnvironment['TESTCONTAINERS_REUSE_ENABLE'] === 'false' &&
    fullGateIndex >= 0 &&
    fullGateIndex < loginIndex &&
    fullGateIndex < buildIndex &&
    isRecord(imageMetadata) &&
    imageMetadata['shell'] === 'bash' &&
    typeof imageMetadataSource === 'string' &&
    imageMetadataSource.includes('repository="${GITHUB_REPOSITORY,,}"') &&
    imageMetadataSource.includes('name=ghcr.io/${repository}') &&
    imageMetadataSource.includes('git show -s --format=%cI "${GITHUB_SHA}"') &&
    setupBuildx !== undefined &&
    isRecord(loginWith) &&
    loginWith['registry'] === 'ghcr.io' &&
    loginWith['username'] === '${{ github.actor }}' &&
    loginWith['password'] === '${{ secrets.GITHUB_TOKEN }}' &&
    buildSteps.length === 1 &&
    build?.['id'] === 'build' &&
    isRecord(buildWith) &&
    buildWith['context'] === '.' &&
    buildWith['file'] === 'Dockerfile' &&
    buildWith['platforms'] === 'linux/amd64' &&
    buildWith['push'] === true &&
    buildWith['tags'] === '${{ steps.image.outputs.name }}:${{ github.sha }}' &&
    buildWith['sbom'] === true &&
    buildWith['provenance'] === 'mode=max,version=v1' &&
    buildWith['cache-from'] === 'type=gha' &&
    buildWith['cache-to'] === 'type=gha,mode=max' &&
    buildArguments.length === 3 &&
    buildArguments.includes('BUILD_REVISION=${{ github.sha }}') &&
    buildArguments.includes(
      'BUILD_SOURCE=${{ github.server_url }}/${{ github.repository }}',
    ) &&
    buildArguments.includes(
      'BUILD_CREATED=${{ steps.image.outputs.created }}',
    ) &&
    isRecord(trivyWith) &&
    trivyWith['image-ref'] ===
      '${{ steps.image.outputs.name }}@${{ steps.build.outputs.digest }}' &&
    trivyWith['scanners'] === 'vuln' &&
    trivyWith['severity'] === 'HIGH,CRITICAL' &&
    trivyWith['ignore-unfixed'] === true &&
    trivyWith['exit-code'] === 1 &&
    trivyWith['format'] === 'json' &&
    trivyWith['output'] === 'trivy.json' &&
    isRecord(attestationReader) &&
    attestationReader['if'] === '${{ !cancelled() }}' &&
    typeof attestationReader['run'] === 'string' &&
    attestationReader['run'].includes(
      '--reference "${{ steps.image.outputs.name }}@${{ steps.build.outputs.digest }}"',
    ) &&
    attestationReader['run'].includes('--sbom-output sbom.spdx.json') &&
    attestationReader['run'].includes('--provenance-output provenance.json') &&
    isRecord(evidenceWriter) &&
    evidenceWriter['if'] === '${{ !cancelled() }}' &&
    typeof evidenceWriter['run'] === 'string' &&
    evidenceWriter['run'].includes(
      '--image "${{ steps.image.outputs.name }}"',
    ) &&
    evidenceWriter['run'].includes(
      '--digest "${{ steps.build.outputs.digest }}"',
    ) &&
    evidenceWriter['run'].includes('--revision "${{ github.sha }}"') &&
    evidenceWriter['run'].includes('--openapi docs/api/openapi.json') &&
    evidenceWriter['run'].includes('--output image-evidence.json') &&
    isRecord(upload) &&
    upload['if'] === '${{ !cancelled() }}' &&
    isRecord(uploadWith) &&
    uploadWith['name'] === 'stage-image-${{ github.sha }}' &&
    uploadWith['if-no-files-found'] === 'error' &&
    uploadWith['retention-days'] === 30 &&
    uploadedPaths.length === 5 &&
    [
      'image-evidence.json',
      'sbom.spdx.json',
      'provenance.json',
      'trivy.json',
      'docs/api/openapi.json',
    ].every((path) => uploadedPaths.includes(path))

  if (!valid) issues.push('Stage image workflow contract is incomplete')
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
  if (path === 'stage-image.yml') {
    validateStageWorkflow(workflow, pins, issues)
  }
  if (isPullRequest) validatePullRequestWorkflow(workflow, pins, issues)
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
  if (input.dockerignore !== undefined) {
    validateDockerignore(input.dockerignore, issues)
  }
  if ((input.dockerfile === undefined) !== (input.dockerignore === undefined)) {
    issues.push('Dockerfile and dockerignore must be introduced together')
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
  const [dockerfile, dockerignore, workflows] = await Promise.all([
    readOptionalFile(join(projectRoot, 'Dockerfile')),
    readOptionalFile(join(projectRoot, '.dockerignore')),
    readWorkflows(join(projectRoot, '.github/workflows')),
  ])
  validateSupplyChainFiles({
    ...(dockerfile === undefined ? {} : { dockerfile }),
    ...(dockerignore === undefined ? {} : { dockerignore }),
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
