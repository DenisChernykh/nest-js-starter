import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface PackageManifest {
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly scripts?: Readonly<Record<string, string>>
}

describe('TypeScript compiler contract', () => {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as PackageManifest

  it('uses TypeScript 7 for production compiler scripts and TypeScript 6 only as compatibility API', () => {
    expect(manifest.devDependencies).toEqual(
      expect.objectContaining({
        '@typescript/native': 'npm:typescript@7.0.2',
        typescript: 'npm:@typescript/typescript6@6.0.2',
      }),
    )

    const expectedCompilerCommands = {
      'build:compiled': 'tsc -p tsconfig.build.json',
      'typecheck:src': 'tsc --noEmit -p tsconfig.json',
      'typecheck:test': 'tsc --noEmit -p tsconfig.test.json',
    } as const

    for (const [scriptName, compilerCommand] of Object.entries(
      expectedCompilerCommands,
    )) {
      const script = manifest.scripts?.[scriptName]

      expect(script).toContain(compilerCommand)
      expect(script).not.toContain('tsc6')
    }
  })
})
