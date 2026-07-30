import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface ResolvedComposePort {
  readonly host_ip?: string
  readonly published?: string
  readonly target?: number
}

interface ResolvedComposeService {
  readonly build?: unknown
  readonly develop?: unknown
  readonly environment?: Readonly<Record<string, string>>
  readonly image?: string
  readonly ports?: readonly ResolvedComposePort[]
  readonly profiles?: readonly string[]
}

interface ResolvedComposeConfiguration {
  readonly services: Readonly<Record<string, ResolvedComposeService>>
}

const image =
  'ghcr.io/example/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const redisUrl = 'redis://default:smoke-password@redis-coordination:6379'

function resolveImageSmokeCompose(): ResolvedComposeConfiguration {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nest-js-starter-smoke-contract-'),
  )
  const envFilePath = join(temporaryDirectory, 'runtime.env')

  writeFileSync(
    envFilePath,
    [
      'API_DOCS_MODE=off',
      'API_HOST=0.0.0.0',
      'API_PORT=3000',
      'AUTH_CSRF_SECRET=csrf-secret',
      'AUTH_NETWORK_METADATA_SECRET=network-secret',
      'AUTH_RATE_LIMIT_KEY_SECRET=rate-limit-secret',
      'AUTH_SESSION_KEY_SECRET=session-secret',
      'CORS_ORIGINS=https://api.invalid',
      'DATABASE_URL=postgresql://starter:postgres-password@postgres:5432/starter?schema=public',
      `IMAGE=${image}`,
      'LOG_LEVEL=info',
      'NODE_ENV=production',
      'OTEL_SDK_DISABLED=true',
      'POSTGRES_DB=starter',
      'POSTGRES_PASSWORD=postgres-password',
      'POSTGRES_PORT=0',
      'POSTGRES_USER=starter',
      'PUBLIC_API_URL=https://api.invalid',
      `REDIS_COORDINATION_URL=${redisUrl}`,
      'REDIS_KEY_PREFIX=smoke-contract',
      'REDIS_PASSWORD=smoke-password',
      'REDIS_PORT=0',
      'SERVICE_REVISION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'SERVICE_VERSION=0.0.0-smoke',
      `SMOKE_ENV_FILE=${envFilePath}`,
      'TRUST_PROXY_CIDRS=127.0.0.1/32',
      '',
    ].join('\n'),
    { encoding: 'utf8', mode: 0o600 },
  )

  try {
    const result = spawnSync(
      'docker',
      [
        'compose',
        '--project-name',
        'nest-js-starter-smoke-contract',
        '--env-file',
        envFilePath,
        '--profile',
        'development',
        '--file',
        'docker-compose.yml',
        '--file',
        'test/fixtures/oci/docker-compose.image-smoke.yml',
        'config',
        '--format',
        'json',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    if (result.status !== 0) {
      throw new Error(
        `Docker Compose config exited with ${String(result.status)}: ${result.stderr}`,
      )
    }

    return JSON.parse(result.stdout) as ResolvedComposeConfiguration
  } finally {
    rmSync(temporaryDirectory, { recursive: true })
  }
}

function requireService(
  configuration: ResolvedComposeConfiguration,
  serviceName: string,
): ResolvedComposeService {
  const service = configuration.services[serviceName]

  if (service === undefined) {
    throw new Error(`Missing required Compose service: ${serviceName}`)
  }

  return service
}

describe('OCI image smoke Compose contract', () => {
  it('isolates the published image from local development settings', () => {
    const configuration = resolveImageSmokeCompose()
    const api = requireService(configuration, 'api')
    const migrator = requireService(configuration, 'migrator')

    for (const service of [api, migrator]) {
      expect(service.image).toBe(image)
      expect(service.build).toBeUndefined()
    }

    expect(api.develop).toBeUndefined()
    expect(api.profiles).toBeUndefined()
    expect(api.environment).toMatchObject({
      NODE_ENV: 'production',
      OTEL_SDK_DISABLED: 'true',
      REDIS_COORDINATION_URL: redisUrl,
    })
    expect(api.environment).not.toHaveProperty('OTEL_EXPORTER_OTLP_ENDPOINT')
    expect(api.ports).toEqual([
      expect.objectContaining({
        host_ip: '127.0.0.1',
        target: 3000,
      }),
    ])
    expect(api.ports?.[0]?.published).toBeUndefined()
    expect(migrator.environment).toMatchObject({
      DATABASE_URL:
        'postgresql://starter:postgres-password@postgres:5432/starter?schema=public',
      NODE_ENV: 'production',
      REDIS_COORDINATION_URL: redisUrl,
    })
  })
})
