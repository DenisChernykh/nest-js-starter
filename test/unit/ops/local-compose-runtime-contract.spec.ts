import { spawnSync } from 'node:child_process'

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

function resolveLocalCompose(): ResolvedComposeConfiguration {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      'nest-js-starter-contract',
      '--env-file',
      '.env.example',
      '--profile',
      'development',
      '--profile',
      'observability',
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
        REDIS_PORT: '36379',
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
    expect(api.depends_on?.['redis-coordination']?.condition).toBe(
      'service_healthy',
    )
    expect(api.depends_on).not.toHaveProperty('alloy')
    expect(api.environment).toEqual(
      expect.objectContaining({
        API_HOST: '0.0.0.0',
        API_PORT: '3000',
        DATABASE_URL:
          'postgresql://nest_js_starter:nest_js_starter@postgres:5432/nest_js_starter?schema=public',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4318',
        OTEL_SDK_DISABLED: 'false',
        REDIS_COORDINATION_URL:
          'redis://default:local-development-only@redis-coordination:6379',
      }),
    )
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
})
