import { randomBytes } from 'node:crypto'
import { dirname, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const composeProjectName = /^nest-js-starter-smoke-[1-9]\d*$/u
const imageReference =
  /^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*|@sha256:[0-9a-f]{64})$/u
const fullRevision = /^[0-9a-f]{40}$/u

/** Contains generated credentials used only by one isolated image smoke run. */
export interface SmokeSecrets {
  readonly authCsrfSecret: string
  readonly authNetworkMetadataSecret: string
  readonly authRateLimitKeySecret: string
  readonly authSessionKeySecret: string
  readonly postgresPassword: string
  readonly redisPassword: string
}

/** Describes project-scoped Docker Compose command construction inputs. */
export interface ComposeCommandInput {
  readonly composeFiles: readonly string[]
  readonly envFilePath: string
  readonly projectName: string
}

/** Defines bounded, injectable HTTP readiness polling behavior. */
export interface HttpReadinessOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly intervalMs: number
  readonly now?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly timeoutMs: number
}

/** Captures the immutable runtime config required by the image smoke. */
export interface ImageRuntimeInspection {
  readonly cmd: readonly string[]
  readonly revision: string
  readonly source: string
  readonly user: string
}

/** Captures an in-container filesystem and numeric identity probe. */
export interface RuntimeProbe {
  readonly devBinaries: readonly string[]
  readonly forbiddenPaths: readonly string[]
  readonly gid: number
  readonly requiredPaths: readonly string[]
  readonly uid: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * Restricts destructive Compose commands to the smoke harness namespace.
 *
 * @param value - Candidate Docker Compose project name.
 * @returns The validated name for direct command construction.
 * @throws Error when the name is empty, shared or outside the owned namespace.
 */
export function validateComposeProjectName(value: string): string {
  if (!composeProjectName.test(value)) {
    throw new Error('Invalid OCI smoke Compose project name')
  }
  return value
}

/**
 * Rejects empty, shell-like and mutable-latest image references.
 *
 * @param value - Local tag or immutable registry digest to exercise.
 * @returns The validated reference without normalization.
 * @throws Error when the reference is unsafe or points to `latest`.
 */
export function validateImageReference(value: string): string {
  if (!imageReference.test(value) || value.endsWith(':latest')) {
    throw new Error('Invalid OCI smoke image reference')
  }
  return value
}

/**
 * Guards temporary cleanup against root, home and unrelated directories.
 *
 * @param path - Candidate directory created for this smoke run.
 * @param homeDirectory - Current user home directory that must never be owned.
 * @throws Error when recursive cleanup could escape the smoke namespace.
 */
export function assertSafeTemporaryDirectory(
  path: string,
  homeDirectory: string,
): void {
  const absolutePath = resolve(path)
  const absoluteHome =
    homeDirectory.trim() === '' ? undefined : resolve(homeDirectory)
  const withinHome =
    absoluteHome !== undefined &&
    (absolutePath === absoluteHome ||
      (!relative(absoluteHome, absolutePath).startsWith('..') &&
        !relative(absoluteHome, absolutePath).startsWith('/')))
  if (
    absolutePath === '/' ||
    withinHome ||
    !/^nest-js-starter-smoke-[1-9]\d*-[A-Za-z0-9_-]+$/u.test(
      absolutePath.split('/').at(-1) ?? '',
    )
  ) {
    throw new Error('Unsafe OCI smoke temporary directory')
  }
}

/**
 * Generates independent 32-byte base64url credentials for one smoke run.
 *
 * @param bytes - Injectable cryptographic byte source used by unit tests.
 * @returns Five distinct unpadded values suitable for env-file serialization.
 * @throws Error when the byte source produces duplicate credentials.
 */
export function createSmokeSecrets(
  bytes: (size: number) => Buffer = randomBytes,
): SmokeSecrets {
  const values = Array.from({ length: 6 }, () =>
    bytes(32).toString('base64url'),
  )
  if (new Set(values).size !== values.length) {
    throw new Error('OCI smoke secret generator produced duplicates')
  }
  const [
    postgresPassword,
    authSessionKeySecret,
    authCsrfSecret,
    authRateLimitKeySecret,
    authNetworkMetadataSecret,
    redisPassword,
  ] = values
  if (
    postgresPassword === undefined ||
    authSessionKeySecret === undefined ||
    authCsrfSecret === undefined ||
    authRateLimitKeySecret === undefined ||
    authNetworkMetadataSecret === undefined ||
    redisPassword === undefined
  ) {
    throw new Error('OCI smoke secret generator returned incomplete output')
  }
  return {
    authCsrfSecret,
    authNetworkMetadataSecret,
    authRateLimitKeySecret,
    authSessionKeySecret,
    postgresPassword,
    redisPassword,
  }
}

/**
 * Builds an argv-only Docker Compose command scoped to one owned project.
 *
 * @param input - Compose files, env file and validated project identity.
 * @param command - Compose subcommand arguments without a shell.
 * @returns Arguments beginning with `compose` for `execFile("docker", args)`.
 * @throws Error when paths or project ownership are incomplete.
 */
export function createComposeArgs(
  input: ComposeCommandInput,
  command: readonly string[],
): string[] {
  const projectName = validateComposeProjectName(input.projectName)
  const envDirectoryName = dirname(input.envFilePath).split('/').at(-1)
  if (
    input.composeFiles.length === 0 ||
    input.composeFiles.some((path) => path.trim() === '') ||
    command.length === 0 ||
    (envDirectoryName !== projectName &&
      !envDirectoryName?.startsWith(`${projectName}-`))
  ) {
    throw new Error('Invalid OCI smoke Compose command inputs')
  }
  return [
    'compose',
    '--env-file',
    input.envFilePath,
    '--project-name',
    projectName,
    ...input.composeFiles.flatMap((path) => ['--file', path]),
    ...command,
  ]
}

/**
 * Polls one HTTP readiness endpoint until 200 or a bounded deadline.
 *
 * @param url - Absolute loopback readiness URL.
 * @param options - Timeout, interval and optional deterministic adapters.
 * @throws Error when readiness does not reach 200 before the deadline.
 */
export async function waitForHttpReady(
  url: string,
  options: HttpReadinessOptions,
): Promise<void> {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((milliseconds) => delay(milliseconds))
  const deadline = now() + options.timeoutMs
  while (now() <= deadline) {
    try {
      const remaining = Math.max(1, deadline - now())
      const response = await fetchImplementation(url, {
        signal: AbortSignal.timeout(Math.min(options.intervalMs, remaining)),
      })
      if (response.status === 200) return
    } catch {
      // Connection refusal and per-attempt timeout are retried until deadline.
    }
    const remaining = deadline - now()
    if (remaining <= 0) break
    await sleep(Math.min(options.intervalMs, remaining))
  }
  throw new Error(
    `OCI image did not become ready within ${options.timeoutMs}ms`,
  )
}

/**
 * Parses Docker image inspect JSON and enforces runtime metadata invariants.
 *
 * @param value - Parsed `docker image inspect` JSON.
 * @param expectedRevision - Exact 40-hex revision used for the build.
 * @returns Minimal validated runtime configuration.
 * @throws Error for root, unexpected command, label or source metadata.
 */
export function parseImageInspection(
  value: unknown,
  expectedRevision: string,
): ImageRuntimeInspection {
  const candidates: readonly unknown[] = Array.isArray(value) ? value : []
  const candidate = candidates[0]
  const config = isRecord(candidate) ? candidate['Config'] : undefined
  const labels = isRecord(config) ? config['Labels'] : undefined
  const cmd = isRecord(config) ? config['Cmd'] : undefined
  const user = isRecord(config) ? config['User'] : undefined
  const revision = isRecord(labels)
    ? labels['org.opencontainers.image.revision']
    : undefined
  const source = isRecord(labels)
    ? labels['org.opencontainers.image.source']
    : undefined
  let sourceUrl: URL | undefined
  try {
    if (typeof source === 'string') sourceUrl = new URL(source)
  } catch {
    sourceUrl = undefined
  }
  if (
    !fullRevision.test(expectedRevision) ||
    user !== 'node' ||
    !isStringArray(cmd) ||
    cmd.length !== 2 ||
    cmd[0] !== 'node' ||
    cmd[1] !== 'dist/bootstrap/api/main.js' ||
    revision !== expectedRevision ||
    typeof source !== 'string' ||
    sourceUrl?.protocol !== 'https:' ||
    sourceUrl.username !== '' ||
    sourceUrl.password !== ''
  ) {
    throw new Error('Invalid OCI image runtime configuration')
  }
  return { cmd: [cmd[0], cmd[1]], revision, source, user }
}

/**
 * Enforces numeric non-root execution and runtime filesystem allow/denylists.
 *
 * @param probe - Parsed JSON emitted by the in-container Node probe.
 * @throws Error when required files are absent or forbidden/dev files exist.
 */
export function assertRuntimeProbe(probe: RuntimeProbe): void {
  const requiredPaths = [
    '/app/dist',
    '/app/node_modules',
    '/app/package.json',
    '/app/prisma',
    '/app/prisma.config.ts',
  ]
  if (
    !Number.isInteger(probe.uid) ||
    probe.uid <= 0 ||
    !Number.isInteger(probe.gid) ||
    probe.gid <= 0 ||
    probe.requiredPaths.length !== requiredPaths.length ||
    !requiredPaths.every((path) => probe.requiredPaths.includes(path)) ||
    probe.forbiddenPaths.length > 0 ||
    probe.devBinaries.length > 0
  ) {
    throw new Error('Invalid OCI image runtime filesystem')
  }
}
