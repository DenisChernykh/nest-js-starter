import {
  DisabledUserError,
  UnknownRoleAssignmentError,
} from '@/modules/auth/application/auth-errors'
import { definePermissions } from '@/modules/auth/application/permission'
import {
  RoleRegistry,
  SYSTEM_ADMIN_PERMISSIONS,
  SYSTEM_ADMIN_ROLE,
} from '@/modules/auth/application/role-registry'

describe('RoleRegistry', () => {
  it('validates canonical permissions and rejects duplicates or wildcards', () => {
    expect(definePermissions(['system.docs.read'])).toEqual([
      'system.docs.read',
    ])
    expect(() => definePermissions(['System.Docs.Read'])).toThrow()
    expect(() => definePermissions(['*'])).toThrow()
    expect(() =>
      definePermissions(['system.docs.read', 'system.docs.read']),
    ).toThrow()
  })

  it('rejects duplicate role definitions at startup', () => {
    const permissions = definePermissions(['system.docs.read'])

    expect(
      () =>
        new RoleRegistry([
          { key: 'system.admin', permissions },
          { key: 'system.admin', permissions },
        ]),
    ).toThrow()
  })

  it('fails closed for unknown durable role assignments', () => {
    const registry = new RoleRegistry([
      {
        key: 'system.admin',
        permissions: SYSTEM_ADMIN_PERMISSIONS,
      },
    ])

    expect(() => registry.resolve('active', ['future.role'])).toThrow(
      UnknownRoleAssignmentError,
    )
  })

  it('fails closed for a disabled durable user', () => {
    const registry = new RoleRegistry([])

    expect(() => registry.resolve('disabled', [])).toThrow(DisabledUserError)
  })

  it('returns an immutable deterministic union with explicit admin docs access', () => {
    const alpha = definePermissions(['catalog.read', 'system.docs.read'])
    const beta = definePermissions(['catalog.write', 'catalog.read'])
    const registry = new RoleRegistry([
      { key: 'role.beta', permissions: beta },
      { key: 'role.alpha', permissions: alpha },
    ])

    const result = registry.resolve('active', ['role.beta', 'role.alpha'])

    expect([...result]).toEqual([
      'catalog.read',
      'catalog.write',
      'system.docs.read',
    ])
    expect(SYSTEM_ADMIN_PERMISSIONS).toContain('system.docs.read')
    expect(SYSTEM_ADMIN_ROLE.key).toBe('system.admin')
    expect(Object.isFrozen(result)).toBe(true)
    expect('add' in result).toBe(false)
  })
})
