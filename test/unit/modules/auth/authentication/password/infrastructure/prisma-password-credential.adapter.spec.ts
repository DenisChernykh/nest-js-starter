import { PrismaPasswordCredentialAdapter } from '@/modules/auth/authentication/password/infrastructure/prisma-password-credential.adapter'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import type { TransactionPort } from '@/shared/application/transaction.port'

function providerFor(client: object): PrismaClientProvider {
  return {
    withClient: (operation: (value: object) => Promise<unknown>) =>
      operation(client),
  } as unknown as PrismaClientProvider
}

function transactionHarness(): {
  readonly transaction: TransactionPort
  readonly run: jest.Mock
} {
  const run = jest.fn()
  return {
    transaction: {
      run: async <T>(operation: () => Promise<T>): Promise<T> => {
        run(operation)
        return operation()
      },
    },
    run,
  }
}

describe('PrismaPasswordCredentialAdapter', () => {
  it('reads credential snapshots through normalized email and user id', async () => {
    const row = {
      id: 'user-1',
      email: 'User@Example.com',
      normalizedEmail: 'user@example.com',
      status: 'ACTIVE',
      emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
      sessionGeneration: 2n,
      roles: [{ roleKey: 'writer' }],
      credential: { passwordHash: 'hash', version: 4 },
    }
    const findUnique = jest.fn().mockResolvedValue(row)
    const { transaction } = transactionHarness()
    const adapter = new PrismaPasswordCredentialAdapter(
      providerFor({ user: { findUnique } }),
      transaction,
    )

    await expect(
      adapter.findCredentialByNormalizedEmail('user@example.com'),
    ).resolves.toMatchObject({
      userId: 'user-1',
      passwordHash: 'hash',
      passwordVersion: 4,
    })
    await expect(
      adapter.findCredentialByUserId('user-1'),
    ).resolves.toMatchObject({
      userId: 'user-1',
      passwordHash: 'hash',
      passwordVersion: 4,
    })
    expect(findUnique).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { normalizedEmail: 'user@example.com' },
      }),
    )
    expect(findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { id: 'user-1' } }),
    )
  })

  it('keeps password replacement and invalidation inside transaction boundaries', async () => {
    const queryRaw = jest.fn().mockResolvedValue([])
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 })
    const update = jest.fn().mockResolvedValue({ sessionGeneration: 5n })
    const { transaction, run } = transactionHarness()
    const adapter = new PrismaPasswordCredentialAdapter(
      providerFor({
        $queryRaw: queryRaw,
        passwordCredential: { updateMany },
        passwordResetToken: { deleteMany },
        user: { update },
      }),
      transaction,
    )

    await expect(
      adapter.replacePasswordIfVersion('user-1', 3, 'rehash'),
    ).resolves.toBe(true)
    await expect(
      adapter.changePasswordAndInvalidate({
        userId: 'user-1',
        expectedVersion: 4,
        passwordHash: 'next-hash',
      }),
    ).resolves.toBe(true)

    expect(run).toHaveBeenCalledTimes(2)
    expect(queryRaw).toHaveBeenCalledTimes(2)
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 'user-1', version: 3 },
      data: { passwordHash: 'rehash', version: { increment: 1 } },
    })
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'user-1', version: 4 },
      data: { passwordHash: 'next-hash', version: { increment: 1 } },
    })
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        sessionGeneration: { increment: 1 },
        accountRevision: { increment: 1 },
      },
    })
  })

  it('does not invalidate sessions when optimistic password replacement loses', async () => {
    const deleteMany = jest.fn()
    const update = jest.fn()
    const { transaction } = transactionHarness()
    const adapter = new PrismaPasswordCredentialAdapter(
      providerFor({
        $queryRaw: jest.fn().mockResolvedValue([]),
        passwordCredential: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        passwordResetToken: { deleteMany },
        user: { update },
      }),
      transaction,
    )

    await expect(
      adapter.changePasswordAndInvalidate({
        userId: 'user-1',
        expectedVersion: 4,
        passwordHash: 'next-hash',
      }),
    ).resolves.toBe(false)
    expect(deleteMany).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})
