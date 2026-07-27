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

    for (const scriptName of [
      'build:compiled',
      'typecheck:src',
      'typecheck:test',
    ]) {
      const script = manifest.scripts?.[scriptName]

      expect(script).toContain('tsc')
      expect(script).not.toContain('tsc6')
    }
  })
})
