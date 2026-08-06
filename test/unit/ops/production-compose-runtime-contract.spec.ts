import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface ResolvedComposeDependency {
  readonly condition?: string
  readonly required?: boolean
}

interface ResolvedComposeHealthcheck {
  readonly test?: readonly string[]
}

interface ResolvedComposeLogging {
  readonly driver?: string
  readonly options?: Readonly<Record<string, string>>
}

interface ResolvedComposeService {
  readonly build?: unknown
  readonly depends_on?: Readonly<Record<string, ResolvedComposeDependency>>
  readonly develop?: unknown
  readonly env_file?: unknown
  readonly environment?: Readonly<Record<string, string>>
  readonly healthcheck?: ResolvedComposeHealthcheck
  readonly image?: string
  readonly logging?: ResolvedComposeLogging
  readonly networks?: Readonly<
    Record<string, { readonly aliases?: readonly string[] } | null>
  >
  readonly ports?: readonly unknown[]
  readonly profiles?: readonly string[]
  readonly restart?: string
  readonly stop_grace_period?: string
  readonly volumes?: readonly {
    readonly source?: string
    readonly target?: string
    readonly type?: string
  }[]
}

interface ResolvedComposeNetwork {
  readonly external?: boolean
  readonly internal?: boolean
  readonly name?: string
}

interface ResolvedComposeConfiguration {
  readonly networks?: Readonly<Record<string, ResolvedComposeNetwork>>
  readonly services: Readonly<Record<string, ResolvedComposeService>>
  readonly volumes?: Readonly<Record<string, unknown>>
}

const appImage =
  'ghcr.io/example/nest-js-starter@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const postgresImage =
  'postgres:18.4-trixie@sha256:3a82e1f56c8f0f5616a11103ac3d47e632c3938698946a7ad26da0df1334744a'
const redisImage =
  'redis:8.8.0-trixie@sha256:234c902a2db49461a129e2d4aeff85b28cf20187ed274a67f6e50995fa713c7b'
const serviceRevision = '0123456789abcdef0123456789abcdef01234567'
const secrets = Object.freeze({
  adminPassword: 'admin-secret-for-contract-only',
  authCsrf: 'csrf-secret-for-contract-only',
  authNetwork: 'network-secret-for-contract-only',
  authRateLimit: 'rate-limit-secret-for-contract-only',
  authSession: 'session-secret-for-contract-only',
  migratorPassword: 'migrator-secret-for-contract-only',
  redisPassword: 'redis-secret-for-contract-only',
  runtimePassword: 'runtime-secret-for-contract-only',
})

function productionEnvironmentFile(): string {
  return [
    `APP_IMAGE=${appImage}`,
    'API_DOCS_MODE=off',
    'AUTH_CSRF_SECRET=' + secrets.authCsrf,
    'AUTH_NETWORK_METADATA_SECRET=' + secrets.authNetwork,
    'AUTH_RATE_LIMIT_KEY_SECRET=' + secrets.authRateLimit,
    'AUTH_SESSION_KEY_SECRET=' + secrets.authSession,
    'CADDY_NETWORK=shared-caddy-contract',
    'CADDY_UPSTREAM_ALIAS=nest-api-contract-' + serviceRevision,
    'CORS_ORIGINS=https://app.example.invalid',
    'DATABASE_POOL_MAX=10',
    'GHCR_READ_TOKEN=ghcr-token-for-contract-only',
    'GHCR_USERNAME=contract-reader',
    'LOG_LEVEL=info',
    'NODE_ENV=production',
    'OBSERVABILITY_NETWORK=shared-observability-contract',
    'OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318',
    'OTEL_SERVICE_NAME=nest-js-starter',
    'OTEL_SDK_DISABLED=false',
    'POSTGRES_ADMIN_PASSWORD=' + secrets.adminPassword,
    'POSTGRES_ADMIN_USER=postgres_admin',
    'POSTGRES_DB=nest_js_starter',
    'POSTGRES_MIGRATOR_PASSWORD=' + secrets.migratorPassword,
    'POSTGRES_RUNTIME_PASSWORD=' + secrets.runtimePassword,
    'PUBLIC_API_URL=https://api.example.invalid',
    'REDIS_KEY_PREFIX=nest-js-starter',
    'REDIS_PASSWORD=' + secrets.redisPassword,
    'SERVICE_REVISION=' + serviceRevision,
    'SERVICE_VERSION=0.1.0-alpha.0',
    'TRUST_PROXY_CIDRS=10.0.0.0/8',
    '',
  ].join('\n')
}

function resolveProductionCompose(): {
  readonly configuration: ResolvedComposeConfiguration
  readonly envFilePath: string
  readonly composeSource: string
  readonly environmentTemplate: string
} {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nest-js-starter-production-compose-contract-'),
  )
  const envFilePath = join(temporaryDirectory, 'production.env')
  writeFileSync(envFilePath, productionEnvironmentFile(), {
    encoding: 'utf8',
    mode: 0o600,
  })

  try {
    expect(statSync(envFilePath).mode & 0o777).toBe(0o600)
    const commonArguments = [
      'compose',
      '--project-name',
      'nest-js-starter-production-contract',
      '--env-file',
      envFilePath,
      '--file',
      'docker-compose.production.yml',
    ]
    const configArguments = [...commonArguments, 'config', '--format', 'json']
    const result = spawnSync('docker', configArguments, {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      throw new Error(
        `Docker Compose production config exited with ${String(result.status)}: ${result.stderr}`,
      )
    }

    const quietResult = spawnSync(
      'docker',
      [...commonArguments, 'config', '--quiet'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )
    if (quietResult.status !== 0) {
      throw new Error(
        `Docker Compose production quiet config exited with ${String(quietResult.status)}: ${quietResult.stderr}`,
      )
    }

    return {
      configuration: JSON.parse(result.stdout) as ResolvedComposeConfiguration,
      envFilePath,
      composeSource: readFileSync('docker-compose.production.yml', 'utf8'),
      environmentTemplate: readFileSync(
        'docs/runbooks/production.env.example',
        'utf8',
      ),
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

function requireService(
  configuration: ResolvedComposeConfiguration,
  serviceName: string,
): ResolvedComposeService {
  const service = configuration.services[serviceName]
  if (service === undefined) {
    throw new Error(
      `Missing required production Compose service: ${serviceName}`,
    )
  }
  return service
}

function requireLogging(
  service: ResolvedComposeService,
): ResolvedComposeLogging {
  expect(service.logging).toEqual({
    driver: 'json-file',
    options: { 'max-file': '5', 'max-size': '10m' },
  })
  return service.logging!
}

describe('production Compose runtime contract', () => {
  it('validates an immutable, role-separated, externally connected runtime', () => {
    const { configuration, composeSource, environmentTemplate } =
      resolveProductionCompose()
    const serviceNames = Object.keys(configuration.services).sort()

    expect(serviceNames).toEqual(['api', 'migrator', 'postgres', 'redis-auth'])
    expect(configuration.volumes).toEqual({
      'postgres-production-data': {
        name: 'nest-js-starter-production-contract_postgres-production-data',
      },
      'redis-auth-production-data': {
        name: 'nest-js-starter-production-contract_redis-auth-production-data',
      },
    })
    expect(configuration.networks?.application).toEqual(
      expect.objectContaining({ internal: true }),
    )
    expect(configuration.networks?.caddy).toEqual(
      expect.objectContaining({
        external: true,
        name: 'shared-caddy-contract',
      }),
    )
    expect(configuration.networks?.observability).toEqual(
      expect.objectContaining({
        external: true,
        name: 'shared-observability-contract',
      }),
    )

    const postgres = requireService(configuration, 'postgres')
    const redis = requireService(configuration, 'redis-auth')
    const migrator = requireService(configuration, 'migrator')
    const api = requireService(configuration, 'api')

    expect(postgres.image).toBe(postgresImage)
    expect(redis.image).toBe(redisImage)
    for (const service of [migrator, api]) {
      expect(service.image).toBe(appImage)
    }
    for (const service of [postgres, redis, migrator, api]) {
      expect(service.build).toBeUndefined()
      expect(service.develop).toBeUndefined()
      expect(service.profiles).toBeUndefined()
      expect(service.ports).toBeUndefined()
      expect(service.env_file).toBeUndefined()
      requireLogging(service)
    }

    expect(postgres.restart).toBe('unless-stopped')
    expect(redis.restart).toBe('unless-stopped')
    expect(postgres.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'postgres-production-data',
          target: '/var/lib/postgresql',
          type: 'volume',
        }),
        expect.objectContaining({
          read_only: true,
          target: '/opt/nest-js-starter/deployment/postgres/prepare-roles.sql',
        }),
        expect.objectContaining({
          read_only: true,
          target: '/opt/nest-js-starter/deployment/postgres/finalize-roles.sql',
        }),
      ]),
    )
    expect(redis.volumes).toEqual([
      expect.objectContaining({
        source: 'redis-auth-production-data',
        target: '/data',
        type: 'volume',
      }),
    ])
    expect(postgres.healthcheck?.test).toEqual([
      'CMD-SHELL',
      'pg_isready -U postgres_admin -d nest_js_starter',
    ])
    expect(redis.healthcheck?.test).toEqual([
      'CMD-SHELL',
      'REDISCLI_AUTH=$$REDIS_PASSWORD redis-cli ping | grep PONG',
    ])

    expect(migrator.depends_on).toEqual({
      postgres: { condition: 'service_healthy', required: true },
    })
    expect(migrator.restart).toBe('no')
    expect(migrator.environment).toEqual({
      DATABASE_URL:
        'postgresql://app_migrator:migrator-secret-for-contract-only@postgres:5432/nest_js_starter?schema=public',
      NODE_ENV: 'production',
      SERVICE_REVISION: serviceRevision,
      SERVICE_VERSION: '0.1.0-alpha.0',
    })

    expect(api.depends_on).toEqual({
      migrator: { condition: 'service_completed_successfully', required: true },
      postgres: { condition: 'service_healthy', required: true },
      'redis-auth': { condition: 'service_healthy', required: true },
    })
    expect(api.restart).toBe('unless-stopped')
    expect(api.stop_grace_period).toBe('30s')
    expect(api.healthcheck?.test).toEqual([
      'CMD',
      'node',
      '-e',
      expect.stringContaining('http://127.0.0.1:3000/health/ready'),
    ])
    expect(api.networks?.application).toBeNull()
    expect(api.networks?.caddy).toEqual({
      aliases: ['nest-api-contract-' + serviceRevision],
    })
    expect(api.networks?.observability).toBeNull()
    expect(postgres.networks).toEqual({ application: null })
    expect(redis.networks).toEqual({ application: null })
    expect(migrator.networks).toEqual({ application: null })

    expect(api.environment).toEqual(
      expect.objectContaining({
        API_HOST: '0.0.0.0',
        API_PORT: '3000',
        DATABASE_URL:
          'postgresql://app_runtime:runtime-secret-for-contract-only@postgres:5432/nest_js_starter?schema=public',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4318',
        REDIS_AUTH_URL:
          'redis://default:redis-secret-for-contract-only@redis-auth:6379',
        SERVICE_REVISION: serviceRevision,
      }),
    )

    const migratorEnvironment = Object.keys(migrator.environment ?? {})
    const apiEnvironment = Object.keys(api.environment ?? {})
    for (const forbidden of [
      'GHCR_READ_TOKEN',
      'GHCR_USERNAME',
      'POSTGRES_ADMIN_PASSWORD',
      'POSTGRES_MIGRATOR_PASSWORD',
      'POSTGRES_RUNTIME_PASSWORD',
      'REDIS_PASSWORD',
    ]) {
      expect(migratorEnvironment).not.toContain(forbidden)
      expect(apiEnvironment).not.toContain(forbidden)
    }
    for (const forbidden of [
      'AUTH_CSRF_SECRET',
      'AUTH_NETWORK_METADATA_SECRET',
      'AUTH_RATE_LIMIT_KEY_SECRET',
      'AUTH_SESSION_KEY_SECRET',
      'REDIS_PASSWORD',
    ]) {
      expect(migratorEnvironment).not.toContain(forbidden)
    }
    expect(apiEnvironment).not.toContain('MIGRATION_DATABASE_URL')

    expect(composeSource).not.toContain('latest')
    expect(composeSource).not.toContain(secrets.adminPassword)
    expect(composeSource).not.toContain(secrets.runtimePassword)
    expect(environmentTemplate).not.toContain(secrets.adminPassword)
    expect(environmentTemplate).toContain(
      'GHCR_READ_TOKEN=<secret-manager-value>',
    )
    expect(composeSource).not.toContain('env_file:')
  })
})
