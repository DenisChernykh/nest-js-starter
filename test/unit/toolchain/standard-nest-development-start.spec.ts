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
  it('starts the API through Nest CLI watch after generating Prisma Client only', () => {
    const devScript = readPackageManifest().scripts?.dev

    expect(devScript).toContain('prisma:generate')
    expect(devScript).toContain('nest start --watch')
    expect(devScript).not.toContain('tsx watch')
    expect(devScript).not.toMatch(/docker|migrate/)
  })

  it('keeps dev:api as a Nest CLI-compatible development command', () => {
    const devApiScript = readPackageManifest().scripts?.['dev:api']

    expect(devApiScript).toBeDefined()
    expect(devApiScript).not.toContain('tsx watch')
    expect(devApiScript).toMatch(/(?:run dev|nest start --watch)/)
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
