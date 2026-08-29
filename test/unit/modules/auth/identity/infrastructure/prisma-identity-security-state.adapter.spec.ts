import { IdentitySecurityStateIntegrityError } from '@/modules/auth/application/identity-security-state.port'
import { PrismaIdentitySecurityStateAdapter } from '@/modules/auth/identity/infrastructure/prisma-identity-security-state.adapter'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'

function providerFor(client: object): PrismaClientProvider {
  return {
    withClient: (operation: (value: object) => Promise<unknown>) =>
      operation(client),
  } as unknown as PrismaClientProvider
}

describe('PrismaIdentitySecurityStateAdapter', () => {
  it('reads and maps the fresh authorization projection by user id', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'User@Example.com',
      normalizedEmail: 'user@example.com',
      status: 'ACTIVE',
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      sessionGeneration: 3n,
      roles: [{ roleKey: 'writer' }, { roleKey: 'admin' }],
    })
    const adapter = new PrismaIdentitySecurityStateAdapter(
      providerFor({ user: { findUnique } }),
    )

    await expect(adapter.findAuthProjectionByUserId('user-1')).resolves.toEqual(
      {
        userId: 'user-1',
        email: 'User@Example.com',
        normalizedEmail: 'user@example.com',
        status: 'active',
        sessionGeneration: 3n,
        roleKeys: ['admin', 'writer'],
      },
    )
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      include: { roles: { select: { roleKey: true } } },
    })
  })

  it('returns the global epoch and rejects a missing singleton', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ globalSessionEpoch: 9n })
      .mockResolvedValueOnce(null)
    const adapter = new PrismaIdentitySecurityStateAdapter(
      providerFor({ authSecurityState: { findUnique } }),
    )

    await expect(adapter.readGlobalSessionEpoch()).resolves.toBe(9n)
    await expect(adapter.readGlobalSessionEpoch()).rejects.toBeInstanceOf(
      IdentitySecurityStateIntegrityError,
    )
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { globalSessionEpoch: true },
    })
  })
})
