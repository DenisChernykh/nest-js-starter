import { spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import { resolve } from 'node:path'

describe('dependency-cruiser policy', () => {
  function runFixture(fixtureName: string): SpawnSyncReturns<string> {
    const fixture = resolve(`test/fixtures/dependency-cruiser/${fixtureName}`)
    return spawnSync(
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
  }

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

  it('rejects module public entrypoints that export domain internals', () => {
    const fixture = resolve(
      'test/fixtures/dependency-cruiser/module-index-exports-domain',
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
      'module-public-api-must-not-export-domain',
    )
    expect(result.status).toBeGreaterThan(0)
  })

  it('rejects BullMQ imports from application code', () => {
    const result = runFixture('application-imports-bullmq')

    expect(`${result.stdout}${result.stderr}`).toContain(
      'application-must-not-import-non-di-frameworks',
    )
    expect(result.status).toBeGreaterThan(0)
  })

  it('rejects ioredis imports from domain code', () => {
    const result = runFixture('domain-imports-bullmq')

    expect(`${result.stdout}${result.stderr}`).toContain(
      'domain-must-not-import-frameworks',
    )
    expect(result.status).toBeGreaterThan(0)
  })

  it('rejects Nest BullMQ imports from presentation code', () => {
    const result = runFixture('presentation-imports-bullmq')

    expect(`${result.stdout}${result.stderr}`).toContain(
      'presentation-must-not-import-infrastructure',
    )
    expect(result.status).toBeGreaterThan(0)
  })
})
