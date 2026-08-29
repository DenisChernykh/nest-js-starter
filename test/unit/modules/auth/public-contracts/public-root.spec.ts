import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('identity-access public source API', () => {
  it('exports exactly the three approved integration contracts', () => {
    const source = readFileSync(
      resolve('src/modules/auth/index.ts'),
      'utf8',
    ).trim()

    expect(source).toBe(
      [
        "export type { AuthenticatedPrincipal } from './public-contracts/authenticated-principal'",
        "export { CurrentPrincipal } from './public-contracts/current-principal.decorator'",
        "export { RequirePermission } from './public-contracts/require-permission.decorator'",
      ].join('\n'),
    )
  })
})
