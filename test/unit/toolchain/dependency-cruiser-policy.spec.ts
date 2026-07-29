import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

describe('dependency-cruiser policy', () => {
  it('rejects bootstrap imports from module application internals', () => {
    const fixture = resolve(
      'test/fixtures/dependency-cruiser/bootstrap-imports-module-application',
    )
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/dependency-cruiser/bin/dependency-cruise.mjs',
        '--config',
        '.dependency-cruiser.cjs',
        '--output-type',
        'err',
        fixture,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )

    expect(`${result.stdout}${result.stderr}`).toContain(
      'bootstrap-must-import-modules-through-composition',
    )
    expect(result.status).toBeGreaterThan(0)
  })
})
