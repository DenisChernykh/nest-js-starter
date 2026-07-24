import { execFile } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'

import {
  type ComposeCommandInput,
  type RuntimeProbe,
  assertRuntimeProbe,
  assertSafeTemporaryDirectory,
  createComposeArgs,
  createSmokeSecrets,
  parseImageInspection,
  validateComposeProjectName,
  validateImageReference,
  waitForHttpReady,
} from './smoke-support'

interface CommandOutcome {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

interface CliOptions {
  readonly image: string
  readonly revision: string
}

const commandTimeoutMs = 300_000
const commandBufferBytes = 16 * 1024 * 1024

function parseCliOptions(arguments_: readonly string[]): CliOptions {
  const argumentsWithoutSeparator = arguments_.filter((value) => value !== '--')
  const imageIndex = argumentsWithoutSeparator.indexOf('--image')
  const revisionIndex = argumentsWithoutSeparator.indexOf('--revision')
  const image = argumentsWithoutSeparator[imageIndex + 1]
  const revision = argumentsWithoutSeparator[revisionIndex + 1]
  if (
    imageIndex < 0 ||
    revisionIndex < 0 ||
    image === undefined ||
    revision === undefined ||
    !/^[0-9a-f]{40}$/u.test(revision)
  ) {
    throw new Error(
      'Usage: oci:smoke -- --image <reference> --revision <40-hex>',
    )
  }
  return { image: validateImageReference(image), revision }
}

function runCommand(
  file: string,
  arguments_: readonly string[],
): Promise<CommandOutcome> {
  return new Promise((resolveCommand) => {
    execFile(
      file,
      arguments_,
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: commandBufferBytes,
        timeout: commandTimeoutMs,
      },
      (error, stdout, stderr) => {
        const numericCode =
          error !== null && typeof error.code === 'number' ? error.code : 1
        resolveCommand({
          exitCode: error === null ? 0 : numericCode,
          stderr,
          stdout,
        })
      },
    )
  })
}

async function requireCommand(
  file: string,
  arguments_: readonly string[],
  description: string,
): Promise<CommandOutcome> {
  const outcome = await runCommand(file, arguments_)
  if (outcome.exitCode !== 0) {
    throw new Error(
      `${description} failed (exit ${outcome.exitCode})\n${outcome.stderr || outcome.stdout}`,
    )
  }
  return outcome
}

function serializeEnvironment(
  values: Readonly<Record<string, string>>,
): string {
  return `${Object.entries(values)
    .map(([name, value]) => {
      if (!/^[A-Z][A-Z0-9_]*$/u.test(name) || /[\r\n]/u.test(value)) {
        throw new Error('Invalid OCI smoke env-file value')
      }
      return `${name}=${value}`
    })
    .join('\n')}\n`
}

function createEnvironment(
  image: string,
  revision: string,
  envFilePath: string,
): Record<string, string> {
  const secrets = createSmokeSecrets()
  const postgresUser = 'starter'
  const postgresDatabase = 'starter'
  const publicOrigin = 'https://api.invalid'
  return {
    API_DOCS_MODE: 'off',
    API_HOST: '0.0.0.0',
    API_PORT: '3000',
    AUTH_COOKIE_SECURE: 'true',
    AUTH_CSRF_ORIGINS: publicOrigin,
    AUTH_CSRF_SECRET: secrets.authCsrfSecret,
    AUTH_NETWORK_METADATA_SECRET: secrets.authNetworkMetadataSecret,
    AUTH_RATE_LIMIT_KEY_SECRET: secrets.authRateLimitKeySecret,
    AUTH_SESSION_COOKIE_NAME: '__Host-session',
    AUTH_SESSION_KEY_SECRET: secrets.authSessionKeySecret,
    CORS_ORIGINS: publicOrigin,
    DATABASE_URL: `postgresql://${postgresUser}:${secrets.postgresPassword}@postgres:5432/${postgresDatabase}?schema=public`,
    IMAGE: image,
    LOG_LEVEL: 'info',
    NODE_ENV: 'production',
    OTEL_SDK_DISABLED: 'true',
    POSTGRES_DB: postgresDatabase,
    POSTGRES_PASSWORD: secrets.postgresPassword,
    POSTGRES_PORT: '0',
    POSTGRES_USER: postgresUser,
    PUBLIC_API_URL: publicOrigin,
    REDIS_COORDINATION_URL: `redis://default:${secrets.redisPassword}@redis-coordination:6379`,
    REDIS_KEY_PREFIX: `smoke-${process.pid}`,
    REDIS_PASSWORD: secrets.redisPassword,
    REDIS_PORT: '0',
    SERVICE_REVISION: revision,
    SERVICE_VERSION: '0.0.0-smoke',
    SMOKE_ENV_FILE: envFilePath,
    TRUST_PROXY_CIDRS: '127.0.0.1/32',
  }
}

function parsePublishedPort(value: string): string {
  const match = /:(\d+)\s*$/u.exec(value.trim())
  if (match?.[1] === undefined) {
    throw new Error(`Invalid published API port: ${value}`)
  }
  return match[1]
}

async function assertAuthContract(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/v1/auth/me`)
  const body: unknown = await response.json()
  if (
    response.status !== 401 ||
    !response.headers
      .get('content-type')
      ?.startsWith('application/problem+json') ||
    typeof body !== 'object' ||
    body === null ||
    !('code' in body) ||
    body.code !== 'AUTHENTICATION_REQUIRED' ||
    !('status' in body) ||
    body.status !== 401
  ) {
    throw new Error('OCI image auth response does not match OpenAPI contract')
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))
  const projectName = validateComposeProjectName(
    `nest-js-starter-smoke-${process.pid}`,
  )
  const temporaryDirectory = await mkdtemp(join(tmpdir(), `${projectName}-`))
  assertSafeTemporaryDirectory(temporaryDirectory, homedir())
  const envFilePath = join(temporaryDirectory, 'runtime.env')
  const composeInput: ComposeCommandInput = {
    composeFiles: [
      resolve('docker-compose.yml'),
      resolve('test/fixtures/oci/docker-compose.image-smoke.yml'),
    ],
    envFilePath,
    projectName,
  }
  await writeFile(
    envFilePath,
    serializeEnvironment(
      createEnvironment(options.image, options.revision, envFilePath),
    ),
    { encoding: 'utf8', mode: 0o600 },
  )

  let failure: unknown
  try {
    const imageInspection = await requireCommand(
      'docker',
      ['image', 'inspect', options.image],
      'Docker image inspection',
    )
    parseImageInspection(
      JSON.parse(imageInspection.stdout) as unknown,
      options.revision,
    )

    await requireCommand(
      'docker',
      createComposeArgs(composeInput, ['config', '--quiet']),
      'Compose configuration',
    )
    await requireCommand(
      'docker',
      createComposeArgs(composeInput, [
        'up',
        '--detach',
        '--wait',
        'postgres',
        'redis-coordination',
      ]),
      'Dependency startup',
    )

    const invalidMigration = await runCommand(
      'docker',
      createComposeArgs(composeInput, [
        'run',
        '--rm',
        '--no-deps',
        '--env',
        'DATABASE_URL=postgresql://invalid:invalid@postgres:1/invalid',
        'migrator',
      ]),
    )
    if (invalidMigration.exitCode === 0) {
      throw new Error('Invalid database migration unexpectedly succeeded')
    }
    const apiBeforeMigration = await requireCommand(
      'docker',
      createComposeArgs(composeInput, ['ps', '--quiet', 'api']),
      'Pre-migration API state inspection',
    )
    if (apiBeforeMigration.stdout.trim() !== '') {
      throw new Error('API started after a failed migration')
    }

    await requireCommand(
      'docker',
      createComposeArgs(composeInput, ['up', '--detach', 'api']),
      'API and migrator startup',
    )
    const migratorId = (
      await requireCommand(
        'docker',
        createComposeArgs(composeInput, ['ps', '--all', '--quiet', 'migrator']),
        'Migrator state inspection',
      )
    ).stdout.trim()
    const migratorExit = (
      await requireCommand(
        'docker',
        ['inspect', '--format', '{{.State.ExitCode}}', migratorId],
        'Migrator exit inspection',
      )
    ).stdout.trim()
    if (migratorExit !== '0') throw new Error('Migrator did not exit cleanly')

    const publishedPort = parsePublishedPort(
      (
        await requireCommand(
          'docker',
          createComposeArgs(composeInput, ['port', 'api', '3000']),
          'API port inspection',
        )
      ).stdout,
    )
    const baseUrl = `http://127.0.0.1:${publishedPort}`
    await waitForHttpReady(`${baseUrl}/health/ready`, {
      intervalMs: 500,
      timeoutMs: 30_000,
    })
    await assertAuthContract(baseUrl)

    const apiId = (
      await requireCommand(
        'docker',
        createComposeArgs(composeInput, ['ps', '--quiet', 'api']),
        'API container inspection',
      )
    ).stdout.trim()
    const runtimeProbeScript = `const fs=require('node:fs');const required=['/app/dist','/app/node_modules','/app/package.json','/app/prisma','/app/prisma.config.ts'];const forbidden=['/app/src','/app/test','/app/coverage','/app/.env','/app/.git','/usr/local/lib/node_modules/npm','/usr/local/bin/npm','/usr/local/bin/npx'];const dev=['/app/node_modules/.bin/tsx','/app/node_modules/.bin/tsc','/app/node_modules/typescript'];console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),requiredPaths:required.filter(fs.existsSync),forbiddenPaths:forbidden.filter(fs.existsSync),devBinaries:dev.filter(fs.existsSync)}))`
    const runtimeProbe = await requireCommand(
      'docker',
      ['exec', apiId, 'node', '-e', runtimeProbeScript],
      'Runtime filesystem inspection',
    )
    assertRuntimeProbe(JSON.parse(runtimeProbe.stdout) as RuntimeProbe)

    await requireCommand(
      'docker',
      ['stop', '--time', '15', apiId],
      'API SIGTERM stop',
    )
    const apiExit = (
      await requireCommand(
        'docker',
        ['inspect', '--format', '{{.State.ExitCode}}', apiId],
        'API exit inspection',
      )
    ).stdout.trim()
    if (apiExit !== '0')
      throw new Error('API did not exit cleanly after SIGTERM')

    process.stdout.write(
      `OCI image smoke: valid (image=${options.image}, revision=${options.revision})\n`,
    )
  } catch (error: unknown) {
    failure = error
    const logs = await runCommand(
      'docker',
      createComposeArgs(composeInput, ['logs', '--no-color']),
    )
    if (logs.stdout !== '') process.stderr.write(logs.stdout)
    if (logs.stderr !== '') process.stderr.write(logs.stderr)
  } finally {
    const cleanup = await runCommand(
      'docker',
      createComposeArgs(composeInput, [
        'down',
        '--volumes',
        '--remove-orphans',
      ]),
    )
    assertSafeTemporaryDirectory(temporaryDirectory, homedir())
    await rm(temporaryDirectory, { recursive: true })
    if (failure === undefined && cleanup.exitCode !== 0) {
      failure = new Error(`OCI smoke cleanup failed: ${cleanup.stderr}`)
    }
  }
  if (failure !== undefined) {
    throw failure instanceof Error
      ? failure
      : new Error('OCI image smoke failed with an unknown error')
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'OCI image smoke failed'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
