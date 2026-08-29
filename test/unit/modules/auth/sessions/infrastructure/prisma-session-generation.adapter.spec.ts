import { PrismaSessionGenerationAdapter } from '@/modules/auth/sessions/infrastructure/prisma-session-generation.adapter'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import type { TransactionPort } from '@/shared/application/transaction.port'

function providerFor(client: object): PrismaClientProvider {
  return {
    withClient: (operation: (value: object) => Promise<unknown>) =>
      operation(client),
  } as unknown as PrismaClientProvider
}

describe('PrismaSessionGenerationAdapter', () => {
  it('locks the user and increments both invalidation revisions atomically', async () => {
    const run = jest.fn()
    const transaction: TransactionPort = {
      run: async <T>(operation: () => Promise<T>): Promise<T> => {
        run(operation)
        return operation()
      },
    }
    const queryRaw = jest.fn().mockResolvedValue([])
    const update = jest.fn().mockResolvedValue({ sessionGeneration: 8n })
    const adapter = new PrismaSessionGenerationAdapter(
      providerFor({ $queryRaw: queryRaw, user: { update } }),
      transaction,
    )

    await expect(adapter.incrementSessionGeneration('user-1')).resolves.toBe(8n)
    expect(run).toHaveBeenCalledTimes(1)
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        sessionGeneration: { increment: 1 },
        accountRevision: { increment: 1 },
      },
      select: { sessionGeneration: true },
    })
  })
})
