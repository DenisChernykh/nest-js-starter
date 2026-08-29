import { GetMeQuery } from '@/modules/identity-access/authorization/application/get-me.query'
import { definePermissions } from '@/modules/identity-access/authorization/application/permission'
import type { AuthenticatedPrincipal } from '@/modules/identity-access/public-contracts/authenticated-principal'

describe('GetMeQuery', () => {
  it('returns a stable current-principal projection', () => {
    const principal: AuthenticatedPrincipal = {
      userId: 'user',
      sessionId: 'current',
      normalizedEmail: 'user@example.com',
      roleKeys: ['member.reader'],
      permissions: new Set(definePermissions(['catalog.read'])),
    }

    expect(new GetMeQuery().execute(principal)).toEqual({
      userId: 'user',
      normalizedEmail: 'user@example.com',
      roleKeys: ['member.reader'],
      permissions: ['catalog.read'],
    })
  })
})
