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

  it('applies bootstrap and public-domain rules to nested feature-first layers', () => {
    const bootstrapResult = runFixture('bootstrap-nested-feature-import')
    const publicRootResult = runFixture('module-index-nested-domain')

    expect(`${bootstrapResult.stdout}${bootstrapResult.stderr}`).toContain(
      'bootstrap-must-import-modules-through-composition',
    )
    expect(bootstrapResult.status).toBeGreaterThan(0)
    expect(`${publicRootResult.stdout}${publicRootResult.stderr}`).toContain(
      'module-public-api-must-not-export-domain',
    )
    expect(publicRootResult.status).toBeGreaterThan(0)
  })

  it('rejects every reverse edge in the identity-access capability DAG', () => {
    const result = runFixture('identity-access-dag-invalid')
    const output = `${result.stdout}${result.stderr}`

    expect(output).toEqual(
      expect.stringContaining('identity-access-dag-identity-is-foundational'),
    )
    expect(output).toEqual(
      expect.stringContaining(
        'identity-access-dag-sessions-depend-only-on-identity',
      ),
    )
    expect(output).toEqual(
      expect.stringContaining(
        'identity-access-dag-authentication-depends-only-on-sessions',
      ),
    )
    expect(output).toEqual(
      expect.stringContaining(
        'identity-access-dag-authorization-depends-only-on-sessions',
      ),
    )
    expect(output).toEqual(
      expect.stringContaining(
        'identity-access-dag-account-lifecycle-must-not-depend-on-administration',
      ),
    )
    expect(output).toEqual(
      expect.stringContaining(
        'identity-access-dag-account-administration-must-not-depend-on-lifecycle',
      ),
    )
    expect(result.status).toBeGreaterThan(0)
  })

  it('accepts the intended identity-access capability DAG', () => {
    const result = runFixture('identity-access-dag-valid')

    expect(`${result.stdout}${result.stderr}`).toContain(
      'no dependency violations found',
    )
    expect(result.status).toBe(0)
  })

  it('keeps the identity-access root limited to public contracts', () => {
    const invalidResult = runFixture('identity-access-public-root-invalid')
    const validResult = runFixture('identity-access-public-root-valid')

    expect(`${invalidResult.stdout}${invalidResult.stderr}`).toContain(
      'identity-access-public-root-must-export-public-contracts-only',
    )
    expect(`${invalidResult.stdout}${invalidResult.stderr}`).toContain(
      'identity-access-public-contracts-must-not-import-internals',
    )
    expect(invalidResult.status).toBeGreaterThan(0)
    expect(`${validResult.stdout}${validResult.stderr}`).toContain(
      'no dependency violations found',
    )
    expect(validResult.status).toBe(0)
  })

  it('rejects identity-access deep imports from external modules', () => {
    const result = runFixture('identity-access-external-deep-import')

    expect(`${result.stdout}${result.stderr}`).toContain(
      'identity-access-external-consumers-must-use-public-root',
    )
    expect(result.status).toBeGreaterThan(0)
  })

  it('rejects adapter deep imports between identity-access capabilities', () => {
    const result = runFixture('identity-access-capability-deep-import')

    expect(`${result.stdout}${result.stderr}`).toContain(
      'identity-access-account-lifecycle-must-not-deep-import-capability-adapters',
    )
    expect(`${result.stdout}${result.stderr}`).toContain(
      'identity-access-account-lifecycle-composition-must-not-import-capability-implementation',
    )
    expect(result.status).toBeGreaterThan(0)
  })
})
