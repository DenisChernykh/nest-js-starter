import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const observabilityImages = Object.freeze({
  alloy:
    'grafana/alloy:v1.18.0@sha256:491b0578c04983fd54fe99b587b6fab4404dc46d0dc16677bd6b00cc1140b308',
  grafana:
    'grafana/grafana:13.1.0@sha256:121a7a9ece6dc10b969f1f96eed64b4f07dfac0d0b8abc070f7cb83bbde86f63',
  loki: 'grafana/loki:3.7.2@sha256:191d4fdfb7264f16989f0a57f320872620a5a7c2ceeec6229212c4190ec49b86',
  tempo:
    'grafana/tempo:2.10.7@sha256:032b3acb51ed02c4b801473d54bb63e9e9f13738d215126d9843c30283794f4b',
})

interface ResolvedComposeBuild {
  readonly context?: string
  readonly target?: string
}

interface ResolvedComposeDependency {
  readonly condition?: string
  readonly required?: boolean
}

interface ResolvedComposePort {
  readonly host_ip?: string
  readonly published?: string
  readonly target?: number
}

interface ResolvedComposeWatchRule {
  readonly action?: string
  readonly initial_sync?: boolean
  readonly path?: string
  readonly target?: string
}

interface ResolvedComposeVolume {
  readonly read_only?: boolean
  readonly source?: string
  readonly target?: string
  readonly type?: string
}

interface ResolvedComposeService {
  readonly build?: ResolvedComposeBuild
  readonly command?: unknown
  readonly depends_on?: Readonly<Record<string, ResolvedComposeDependency>>
  readonly develop?: {
    readonly watch?: readonly ResolvedComposeWatchRule[]
  }
  readonly environment?: Readonly<Record<string, string>>
  readonly healthcheck?: {
    readonly test?: readonly string[]
  }
  readonly image?: string
  readonly ports?: readonly ResolvedComposePort[]
  readonly profiles?: readonly string[]
  readonly restart?: string
  readonly volumes?: readonly ResolvedComposeVolume[]
}

interface ResolvedComposeConfiguration {
  readonly services: Readonly<Record<string, ResolvedComposeService>>
  readonly volumes?: Readonly<Record<string, unknown>>
}

function resolveLocalCompose(
  profiles: readonly string[] = ['development', 'observability'],
): ResolvedComposeConfiguration {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      'nest-js-starter-contract',
      '--env-file',
      '.env.example',
      ...profiles.flatMap((profile) => ['--profile', profile]),
      'config',
      '--format',
      'json',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        API_PORT: '33000',
        GRAFANA_PORT: '33004',
        OTLP_HTTP_PORT: '34318',
        POSTGRES_PORT: '35432',
        REDIS_AUTH_PORT: '36379',
        REDIS_QUEUE_PORT: '36380',
      },
    },
  )

  if (result.status !== 0) {
    throw new Error(
      `Docker Compose config exited with ${String(result.status)}: ${result.stderr}`,
    )
  }

  return JSON.parse(result.stdout) as ResolvedComposeConfiguration
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

describe('local Compose runtime contract', () => {
  it('runs committed migrations before the watched API and keeps Redis separate', () => {
    const configuration = resolveLocalCompose()
    const migrator = requireService(configuration, 'migrator')
    const api = requireService(configuration, 'api')

    expect(migrator.image).toBe('nest-js-starter:development')
    expect(migrator.build).toEqual(
      expect.objectContaining({ target: 'development' }),
    )
    expect(migrator.command).toEqual([
      'corepack',
      'pnpm@11.15.1',
      'run',
      'start:migrate',
    ])
    expect(migrator.depends_on?.postgres?.condition).toBe('service_healthy')
    expect(Object.keys(migrator.depends_on ?? {})).toEqual(['postgres'])
    expect(migrator.environment).toEqual({
      DATABASE_URL:
        'postgresql://nest_js_starter:nest_js_starter@postgres:5432/nest_js_starter?schema=public',
    })
    expect(migrator.restart).toBe('no')

    expect(api.profiles).toContain('development')
    expect(api.image).toBe('nest-js-starter:development')
    expect(api.build).toEqual(migrator.build)
    expect(api.depends_on?.migrator?.condition).toBe(
      'service_completed_successfully',
    )
    expect(api.depends_on?.['redis-auth']?.condition).toBe('service_healthy')
    expect(api.depends_on).not.toHaveProperty('alloy')
    expect(api.environment).toEqual(
      expect.objectContaining({
        API_HOST: '0.0.0.0',
        API_PORT: '3000',
        DATABASE_URL:
          'postgresql://nest_js_starter:nest_js_starter@postgres:5432/nest_js_starter?schema=public',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4318',
        OTEL_SDK_DISABLED: 'false',
        REDIS_AUTH_URL:
          'redis://default:local-development-only@redis-auth:6379',
      }),
    )
    const redisAuth = requireService(configuration, 'redis-auth')
    expect(redisAuth.command).toEqual([
      'redis-server',
      '--appendonly',
      'yes',
      '--appendfsync',
      'always',
      '--maxmemory-policy',
      'noeviction',
      '--requirepass',
      'local-development-only',
    ])
    expect(redisAuth.ports).toEqual([
      expect.objectContaining({ host_ip: '127.0.0.1', target: 6379 }),
    ])
    expect(redisAuth.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'redis-auth-data',
          target: '/data',
          type: 'volume',
        }),
      ]),
    )
    expect(redisAuth.healthcheck?.test).toEqual([
      'CMD-SHELL',
      'REDISCLI_AUTH=local-development-only redis-cli ping | grep PONG',
    ])
    expect(configuration.services).not.toHaveProperty('redis-queue')
    expect(api.environment).not.toHaveProperty('REDIS_QUEUE_URL')
    expect(api.ports).toEqual([
      expect.objectContaining({ host_ip: '127.0.0.1', target: 3000 }),
    ])

    const watch = api.develop?.watch ?? []

    expect(watch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'sync',
          initial_sync: true,
          target: '/app/src',
        }),
      ]),
    )

    for (const path of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'prisma',
      'prisma.config.ts',
    ]) {
      expect(
        watch.some(
          (rule) =>
            rule.action === 'rebuild' &&
            rule.path?.endsWith(`/${path}`) === true,
        ),
      ).toBe(true)
    }

    for (const path of [
      'nest-cli.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'tsconfig.base.json',
    ]) {
      expect(
        watch.some(
          (rule) =>
            rule.action === 'sync+restart' &&
            rule.path?.endsWith(`/${path}`) === true,
        ),
      ).toBe(true)
    }
  })

  it('exposes an independent queue Redis only through the queues profile', () => {
    const configuration = resolveLocalCompose(['queues'])
    const queue = requireService(configuration, 'redis-queue')

    expect(queue.profiles).toEqual(['queues'])
    expect(queue.image).toBe(
      'redis:8.8.0-trixie@sha256:234c902a2db49461a129e2d4aeff85b28cf20187ed274a67f6e50995fa713c7b',
    )
    expect(queue.command).toEqual([
      'redis-server',
      '--appendonly',
      'yes',
      '--appendfsync',
      'always',
      '--maxmemory-policy',
      'noeviction',
      '--requirepass',
      'local-development-queue-only',
    ])
    expect(queue.ports).toEqual([
      expect.objectContaining({
        host_ip: '127.0.0.1',
        published: '36380',
        target: 6379,
      }),
    ])
    expect(queue.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'redis-queue-data',
          target: '/data',
          type: 'volume',
        }),
      ]),
    )
    expect(queue.healthcheck?.test).toEqual([
      'CMD-SHELL',
      'REDISCLI_AUTH=local-development-queue-only redis-cli ping | grep PONG',
    ])
    expect(configuration.volumes).toHaveProperty('redis-queue-data')
    expect(configuration.services.api).toBeUndefined()
  })

  it('pins and isolates the local observability services', () => {
    const configuration = resolveLocalCompose()

    for (const [serviceName, image] of Object.entries(observabilityImages)) {
      const service = requireService(configuration, serviceName)

      expect(service.profiles).toContain('observability')
      expect(service.image).toBe(image)
    }

    const alloy = requireService(configuration, 'alloy')
    const grafana = requireService(configuration, 'grafana')
    const loki = requireService(configuration, 'loki')
    const tempo = requireService(configuration, 'tempo')

    expect(alloy.environment?.ALLOY_DOCKER_COMPOSE_PROJECT).toBe(
      'nest-js-starter-contract',
    )
    expect(alloy.ports).toEqual([
      expect.objectContaining({ host_ip: '127.0.0.1', target: 4318 }),
    ])
    expect(grafana.ports).toEqual([
      expect.objectContaining({ host_ip: '127.0.0.1', target: 3000 }),
    ])
    expect(loki.ports).toBeUndefined()
    expect(tempo.ports).toBeUndefined()

    for (const serviceName of [
      'postgres',
      'redis-auth',
      'api',
      'alloy',
      'grafana',
    ]) {
      for (const port of requireService(configuration, serviceName).ports ??
        []) {
        expect(port.host_ip).toBe('127.0.0.1')
      }
    }

    expect(alloy.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          read_only: true,
          source: '/var/run/docker.sock',
          target: '/var/run/docker.sock',
          type: 'bind',
        }),
      ]),
    )
    expect(grafana.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          read_only: true,
          target: '/etc/grafana/provisioning/datasources',
          type: 'bind',
        }),
        expect.objectContaining({
          source: 'grafana-data',
          target: '/var/lib/grafana',
          type: 'volume',
        }),
      ]),
    )
    expect(loki.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'loki-data',
          target: '/loki',
          type: 'volume',
        }),
      ]),
    )
    expect(tempo.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'tempo-data',
          target: '/var/tempo',
          type: 'volume',
        }),
      ]),
    )
    expect(configuration.volumes).toHaveProperty('grafana-data')
    expect(configuration.volumes).toHaveProperty('loki-data')
    expect(configuration.volumes).toHaveProperty('redis-auth-data')
    expect(configuration.volumes).toHaveProperty('tempo-data')
  })

  it('preserves correlation literals and bounded low-cardinality storage', () => {
    const configurationPaths = [
      'config/observability/alloy/config.alloy',
      'config/observability/loki/loki.yaml',
      'config/observability/tempo/tempo.yaml',
      'config/observability/grafana/provisioning/datasources/observability.yaml',
    ]

    for (const path of configurationPaths) {
      expect(existsSync(path)).toBe(true)
    }

    if (configurationPaths.some((path) => !existsSync(path))) {
      return
    }

    const provisioning = readFileSync(
      'config/observability/grafana/provisioning/datasources/observability.yaml',
      'utf8',
    )
    const alloy = readFileSync(
      'config/observability/alloy/config.alloy',
      'utf8',
    )
    const loki = readFileSync('config/observability/loki/loki.yaml', 'utf8')
    const tempo = readFileSync('config/observability/tempo/tempo.yaml', 'utf8')
    const labelsStage = /stage\.labels \{([\s\S]*?)\n {2}\}/u.exec(alloy)?.[1]

    expect(provisioning).toContain("'$${__value.raw}'")
    expect(provisioning).toContain('$${__resource.service.name}')
    expect(provisioning).toContain('$${__span.traceId}')
    expect(labelsStage).toContain('environment = ""')
    expect(labelsStage).toContain('level       = ""')
    expect(labelsStage).toContain('service     = ""')
    expect(labelsStage).not.toMatch(
      /requestId|traceId|spanId|event|module|reasonCode/u,
    )
    expect(loki).toMatch(/retention_period:\s+168h/u)
    expect(tempo).toMatch(/block_retention:\s+168h/u)
  })
})
