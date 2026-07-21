import {
  mapAuthProjection,
  mapCredentialSnapshot,
} from '@/modules/auth/infrastructure/prisma-auth.mapper'

describe('Prisma auth mapper', () => {
  const row = {
    id: '0f739752-52a2-45bc-aa9f-3de43f47f47b',
    email: 'Admin@Example.com',
    normalizedEmail: 'admin@example.com',
    status: 'ACTIVE' as const,
    sessionGeneration: 7n,
    roles: [{ roleKey: 'unknown.future' }, { roleKey: 'system.admin' }],
  }

  it('maps durable values without Prisma types and sorts all role keys', () => {
    expect(
      mapCredentialSnapshot({
        ...row,
        credential: { passwordHash: '$argon2id$fixture', version: 3 },
      }),
    ).toEqual({
      userId: row.id,
      email: 'Admin@Example.com',
      normalizedEmail: 'admin@example.com',
      status: 'active',
      sessionGeneration: 7n,
      passwordHash: '$argon2id$fixture',
      passwordVersion: 3,
      roleKeys: ['system.admin', 'unknown.future'],
    })
  })

  it('preserves disabled status and unknown roles in the auth projection', () => {
    expect(mapAuthProjection({ ...row, status: 'DISABLED' })).toEqual({
      userId: row.id,
      email: 'Admin@Example.com',
      normalizedEmail: 'admin@example.com',
      status: 'disabled',
      sessionGeneration: 7n,
      roleKeys: ['system.admin', 'unknown.future'],
    })
  })

  it('returns no credential snapshot when durable credentials are absent', () => {
    expect(mapCredentialSnapshot({ ...row, credential: null })).toBeUndefined()
  })
})
