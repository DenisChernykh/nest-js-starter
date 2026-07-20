import { join } from 'node:path'

import { findModuleImportViolations } from '@scripts/architecture/module-import-policy'
import { runArchitectureCommand } from '@test/architecture/architecture-command'

const fixturesRoot = join('test', 'architecture', 'fixtures')

describe('dependency graph policy', () => {
  it('accepts a valid inward dependency', () => {
    const result = runArchitectureCommand(join(fixturesRoot, 'valid'))

    expect(result.exitCode).toBe(0)
    expect(typeof result.output).toBe('string')
  })

  it.each([
    ['circular-dependency', 'no-circular-dependencies'],
    ['domain-imports-framework', 'domain-must-not-import-frameworks'],
    ['domain-imports-outer-layer', 'domain-must-not-import-outer-layers'],
    ['application-imports-framework', 'application-must-not-import-frameworks'],
    ['application-imports-adapter', 'application-must-not-import-adapters'],
    [
      'presentation-imports-infrastructure',
      'presentation-must-not-import-infrastructure',
    ],
    [
      'presentation-imports-composition',
      'presentation-must-not-import-composition',
    ],
    [
      'infrastructure-imports-presentation',
      'infrastructure-must-not-import-presentation',
    ],
    [
      'infrastructure-imports-composition',
      'infrastructure-must-not-import-composition',
    ],
    ['composition-imports-bootstrap', 'modules-must-not-import-bootstrap'],
    ['platform-imports-module', 'platform-must-not-import-modules'],
    ['shared-imports-platform', 'shared-must-not-import-modules-or-platform'],
    ['src-imports-scripts', 'src-must-not-import-test-scripts-or-templates'],
    ['unresolvable-import', 'no-unresolvable-imports'],
  ])('rejects %s with rule %s', (fixtureName, ruleName) => {
    const result = runArchitectureCommand(join(fixturesRoot, fixtureName))

    expect(result.exitCode).toBeGreaterThan(0)
    expect(result.output).toContain(ruleName)
  })
})

describe('cross-module import policy', () => {
  it('rejects imports into another module internal path', async () => {
    const violations = await findModuleImportViolations(
      join(process.cwd(), fixturesRoot, 'cross-module-internal-import'),
    )

    expect(violations).toEqual([
      expect.objectContaining({
        reason: 'cross-module-internal-import',
        specifier: '@/modules/orders/domain/order',
      }),
    ])
  })

  it('accepts another module public entrypoint', async () => {
    const violations = await findModuleImportViolations(
      join(process.cwd(), fixturesRoot, 'cross-module-public-import'),
    )

    expect(violations).toEqual([])
  })

  it('accepts a bootstrap import of a module composition class', async () => {
    const violations = await findModuleImportViolations(
      join(process.cwd(), fixturesRoot, 'bootstrap-imports-composition'),
    )

    expect(violations).toEqual([])
  })

  it.each([
    [
      'bootstrap-import-outside-composition',
      'bootstrap-import-outside-composition',
    ],
    ['domain-imports-other-module-public', 'domain-imports-other-module'],
    ['template-literal-cross-module-import', 'cross-module-internal-import'],
    ['platform-imports-module', 'platform-or-shared-imports-module'],
    ['relative-cross-module-import', 'relative-cross-module-import'],
    ['module-public-api-invalid', 'module-public-api-exports-non-application'],
  ])('rejects %s with reason %s', async (fixtureName, reason) => {
    const violations = await findModuleImportViolations(
      join(process.cwd(), fixturesRoot, fixtureName),
    )

    expect(violations).toEqual([
      expect.objectContaining({
        reason,
      }),
    ])
  })

  it('accepts a module root that exports only its application boundary', async () => {
    const violations = await findModuleImportViolations(
      join(process.cwd(), fixturesRoot, 'module-public-api-valid'),
    )

    expect(violations).toEqual([])
  })
})
