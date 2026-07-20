import { resolve } from 'node:path'

import { findModuleImportViolations } from '@scripts/architecture/module-import-policy'

describe('OrderManagement module architecture', () => {
  it('keeps its imports and public API inside module boundaries', async () => {
    const sourceRoot = resolve(__dirname, '../../../../src')
    const violations = await findModuleImportViolations(sourceRoot)

    expect(
      violations.filter((violation) =>
        violation.file.startsWith('modules/order-management/'),
      ),
    ).toEqual([])
  })
})
