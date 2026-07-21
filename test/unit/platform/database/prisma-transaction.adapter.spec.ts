import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import type { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { PrismaTransactionAdapter } from '@/platform/database/prisma-transaction.adapter'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'

interface FakeRootClient {
  $transaction: <T>(
    operation: (client: Prisma.TransactionClient) => Promise<T>,
    options: { maxWait: number; timeout: number },
  ) => Promise<T>
}

function createHarness(): {
  readonly adapter: PrismaTransactionAdapter
  readonly context: PrismaTransactionContext
  readonly provider: { withClient: jest.Mock }
  readonly root: FakeRootClient
  readonly transactionClients: Prisma.TransactionClient[]
} {
  const context = new PrismaTransactionContext()
  const transactionClients: Prisma.TransactionClient[] = []
  const root: FakeRootClient = {
    $transaction: jest.fn(async (operation) => {
      const client = { transaction: transactionClients.length + 1 }
      transactionClients.push(client as unknown as Prisma.TransactionClient)
      return operation(client as unknown as Prisma.TransactionClient)
    }),
  }
  const provider = {
    withClient: jest.fn(
      (
        operation: (
          client: PrismaClient | Prisma.TransactionClient,
        ) => Promise<unknown>,
      ) => context.withClient(root as unknown as PrismaClient, operation),
    ),
  }
  const config = {
    database: { transactionMaxWaitMs: 321, transactionTimeoutMs: 654 },
  } as RuntimeConfigService
  return {
    adapter: new PrismaTransactionAdapter(
      provider as unknown as PrismaClientProvider,
      context,
      config,
    ),
    context,
    provider,
    root,
    transactionClients,
  }
}

describe('PrismaTransactionAdapter', () => {
  it('returns outer results, preserves errors and forwards transaction budgets', async () => {
    const { adapter, root } = createHarness()
    const failure = new Error('operation failed')

    await expect(adapter.run(() => Promise.resolve('result'))).resolves.toBe(
      'result',
    )
    await expect(adapter.run(() => Promise.reject(failure))).rejects.toBe(
      failure,
    )
    expect(root.$transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
      maxWait: 321,
      timeout: 654,
    })
  })

  it('joins nested runs without opening a second transaction', async () => {
    const { adapter, root } = createHarness()

    await expect(
      adapter.run(() => adapter.run(() => Promise.resolve('nested'))),
    ).resolves.toBe('nested')
    expect(root.$transaction).toHaveBeenCalledTimes(1)
  })

  it('marks a caught nested rejection rollback-only', async () => {
    const { adapter } = createHarness()
    const nestedFailure = new Error('nested failed')

    await expect(
      adapter.run(async () => {
        await adapter
          .run(() => Promise.reject(nestedFailure))
          .catch(() => undefined)
        return 'must not commit'
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'TransactionRollbackOnlyError',
      }),
    )
  })

  it('does not share clients or rollback state between concurrent contexts', async () => {
    const { adapter, provider, transactionClients } = createHarness()
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const observed: Prisma.TransactionClient[] = []

    const first = adapter.run(async () => {
      await provider.withClient((client: Prisma.TransactionClient) => {
        observed.push(client)
        return Promise.resolve()
      })
      await firstGate
    })
    const second = adapter.run(async () => {
      await provider.withClient((client: Prisma.TransactionClient) => {
        observed.push(client)
        return Promise.resolve()
      })
    })
    await second
    releaseFirst?.()
    await first

    expect(transactionClients).toHaveLength(2)
    expect(observed[0]).not.toBe(observed[1])
  })

  it('asks the provider for admission on every outer transaction', async () => {
    const { adapter, provider } = createHarness()

    await adapter.run(() => Promise.resolve())
    await adapter.run(() => Promise.resolve())

    expect(provider.withClient).toHaveBeenCalledTimes(2)
  })
})
