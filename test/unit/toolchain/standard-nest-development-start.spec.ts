import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>
}

interface NestCliConfiguration {
  readonly entryFile?: string
  readonly monorepo?: boolean
  readonly sourceRoot?: string
  readonly compilerOptions?: {
    readonly builder?: string
    readonly tsConfigPath?: string
  }
}

function readPackageManifest(): PackageManifest {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as PackageManifest
}

describe('standard Nest development start contract', () => {
  it('keeps dev:api as the internal Nest CLI watcher', () => {
    const scripts = readPackageManifest().scripts ?? {}

    expect(scripts['dev:api']).toBe(
      'corepack pnpm@11.15.1 run prisma:generate && nest start --watch --no-shell',
    )
    expect(scripts['dev:api']).not.toContain('tsx watch')
    expect(scripts['dev:api']).not.toContain('docker')
  })

  it('makes dev the canonical observable Compose Watch command', () => {
    const scripts = readPackageManifest().scripts ?? {}

    expect(scripts.dev).toBe(
      'docker compose --profile development --profile observability up --watch api alloy loki tempo grafana',
    )
    expect(scripts['dev:host']).toBe(
      'OTEL_SDK_DISABLED=true corepack pnpm@11.15.1 run dev:api',
    )
    expect(scripts['dev:down']).toBe(
      'docker compose --profile development --profile observability stop api migrator alloy loki tempo grafana postgres redis-coordination',
    )
    expect(scripts['dev:down']).not.toMatch(/\bdown\b|--volumes|docker volume/u)
  })

  it('defines a writable non-root development image target', () => {
    const dockerfileSource = readFileSync(
      join(process.cwd(), 'Dockerfile'),
      'utf8',
    )

    expect(dockerfileSource).toContain('FROM dependencies AS development')
    expect(dockerfileSource).toContain('mkdir -p /app/dist')
    expect(dockerfileSource).toMatch(
      /FROM dependencies AS development[\s\S]*USER node[\s\S]*CMD \["corepack", "pnpm@11\.15\.1", "run", "dev:api"\]/u,
    )
  })

  it('selects the API entry point through the standard TypeScript Nest CLI builder', () => {
    const configurationPath = join(process.cwd(), 'nest-cli.json')

    expect(existsSync(configurationPath)).toBe(true)

    if (!existsSync(configurationPath)) {
      return
    }

    const configuration = JSON.parse(
      readFileSync(configurationPath, 'utf8'),
    ) as NestCliConfiguration

    expect(configuration).toMatchObject({
      sourceRoot: 'src',
      entryFile: 'bootstrap/api/main',
      compilerOptions: {
        builder: 'tsc',
        tsConfigPath: 'tsconfig.build.json',
      },
    })
    expect(configuration.monorepo).not.toBe(true)
  })
})
