import { DatabaseUnavailableError } from '@/platform/database/database.contracts'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { Prisma } from '@/generated/prisma/client'
import { PrismaApprovalRequestRepository } from '@/modules/approval-requests/infrastructure/prisma-approval-request.repository'

describe('PrismaApprovalRequestRepository error boundary', () => {
  it('normalizes an explicit Prisma connectivity failure as database unavailability', async () => {
    const repository = createRejectingRepository(
      new Prisma.PrismaClientKnownRequestError(
        'private database host and port',
        {
          code: 'P1001',
          clientVersion: '7.9.0',
        },
      ),
    )

    await expect(
      repository.findById('19c2dc04-4fd7-42f0-a27a-7365c61650a8'),
    ).rejects.toEqual(new DatabaseUnavailableError())
  })

  it('wraps a Prisma integrity failure as a safe unexpected adapter error', async () => {
    const privateMessage = 'Unique constraint failed on private index details'
    const repository = createRejectingRepository(
      new Prisma.PrismaClientKnownRequestError(privateMessage, {
        code: 'P2002',
        clientVersion: '7.9.0',
        meta: { target: ['private_column'] },
      }),
    )

    const error = await repository
      .findById('19c2dc04-4fd7-42f0-a27a-7365c61650a8')
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(DatabaseUnavailableError)
    expect(error).toMatchObject({
      name: 'UnexpectedDatabaseOperationError',
      message: 'Unexpected database operation failure',
    })
    expect(JSON.stringify(error)).not.toContain(privateMessage)
    expect(JSON.stringify(error)).not.toContain('private_column')
  })

  it('does not classify a mapper status failure as database unavailability', async () => {
    const malformedRow = {
      id: '19c2dc04-4fd7-42f0-a27a-7365c61650a8',
      title: 'Malformed status',
      description: 'The provider succeeded but mapping cannot continue.',
      get status(): never {
        throw new Error('Mapper status failure')
      },
      createdByUserId: 'c725ac30-fd9a-44b9-b07b-b73a11f4d795',
      decidedByUserId: null,
      createdAt: new Date('2026-07-29T10:00:00.000Z'),
      decidedAt: null,
    }
    const client = {
      approvalRequest: {
        findUnique: jest.fn().mockResolvedValue(malformedRow),
      },
    }
    const provider = {
      withClient: jest.fn(
        async (
          operation: (databaseClient: typeof client) => Promise<unknown>,
        ): Promise<unknown> => operation(client),
      ),
    }
    const repository = new PrismaApprovalRequestRepository(
      provider as unknown as PrismaClientProvider,
    )

    const error = await repository
      .findById('19c2dc04-4fd7-42f0-a27a-7365c61650a8')
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(DatabaseUnavailableError)
    expect(error).toMatchObject({ message: 'Mapper status failure' })
  })
})

function createRejectingRepository(
  error: unknown,
): PrismaApprovalRequestRepository {
  return new PrismaApprovalRequestRepository({
    withClient: jest.fn().mockRejectedValue(error),
  } as unknown as PrismaClientProvider)
}
