import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import {
  OutboxTransactionRequiredError,
  TransactionalOutboxWriter,
} from '@/platform/outbox/transactional-outbox.writer'

interface Harness {
  readonly create: jest.Mock
  readonly createCalls: readonly unknown[]
  readonly writer: TransactionalOutboxWriter
  readonly run: <T>(operation: () => Promise<T>) => Promise<T>
}

function createHarness(transactional: boolean): Harness {
  const createCalls: unknown[] = []
  const create = jest.fn((input: { readonly data: unknown }) =>
    Promise.resolve(input.data).then((data) => {
      createCalls.push(input)
      return data
    }),
  )
  const transactionClient = { outboxMessage: { create } }
  const root = {
    $transaction: jest.fn(
      <T>(operation: (client: typeof transactionClient) => Promise<T>) =>
        operation(transactionClient),
    ),
  } as unknown as PrismaClient
  const context = new PrismaTransactionContext()
  const provider = {
    withClient: <T>(
      operation: (
        client: PrismaClient | Prisma.TransactionClient,
      ) => Promise<T>,
    ): Promise<T> => context.withClient(root, operation),
  } as unknown as PrismaClientProvider
  return {
    create,
    createCalls,
    writer: new TransactionalOutboxWriter(
      provider,
      context,
      () => '550e8400-e29b-41d4-a716-446655440000',
      () => new Date('2026-08-08T01:00:00.000Z'),
    ),
    run: <T>(operation: () => Promise<T>): Promise<T> =>
      transactional
        ? context.run(root, operation, { maxWait: 1_000, timeout: 1_000 })
        : operation(),
  }
}

describe('TransactionalOutboxWriter', () => {
  const draft = {
    destination: 'notifications',
    type: 'inquiry.submitted',
    version: 1,
    occurredAt: new Date('2026-08-08T00:00:00.000Z'),
    payload: { inquiryId: 'inquiry-123' },
  }

  it('appends a pending canonical message through the active transaction client', async () => {
    const { create, createCalls, run, writer } = createHarness(true)

    await expect(run(() => writer.append(draft))).resolves.toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440000',
      destination: 'notifications',
      type: 'inquiry.submitted',
      status: 'PENDING',
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(createCalls[0]).toMatchObject({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        destination: 'notifications',
        type: 'inquiry.submitted',
        version: 1,
        status: 'PENDING',
        attemptCount: 0,
        occurredAt: new Date('2026-08-08T00:00:00.000Z'),
        nextAttemptAt: new Date('2026-08-08T01:00:00.000Z'),
        payload: { inquiryId: 'inquiry-123' },
      },
    })
  })

  it('rejects appends outside an active transaction', async () => {
    const { writer } = createHarness(false)

    await expect(writer.append(draft)).rejects.toBeInstanceOf(
      OutboxTransactionRequiredError,
    )
  })
})
