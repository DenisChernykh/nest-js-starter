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

  it('returns the committed decision without a second database admission', async () => {
    const requestId = '19c2dc04-4fd7-42f0-a27a-7365c61650a8'
    const reviewerId = 'c725ac30-fd9a-44b9-b07b-b73a11f4d795'
    const decidedAt = new Date('2026-07-29T10:30:00.000Z')
    const updatedRow = {
      id: requestId,
      title: 'Atomic decision',
      description: 'The committed row is returned by the conditional update.',
      status: 'APPROVED' as const,
      createdByUserId: '38af083a-5aa7-4a69-935b-1f164733a53d',
      decidedByUserId: reviewerId,
      createdAt: new Date('2026-07-29T10:00:00.000Z'),
      decidedAt,
    }
    const client = {
      approvalRequest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateManyAndReturn: jest.fn().mockResolvedValue([updatedRow]),
      },
    }
    let admissions = 0
    const provider = {
      withClient: jest.fn(
        async (
          operation: (databaseClient: typeof client) => Promise<unknown>,
        ): Promise<unknown> => {
          admissions += 1
          if (admissions > 1) throw new DatabaseUnavailableError()
          return operation(client)
        },
      ),
    }
    const repository = new PrismaApprovalRequestRepository(
      provider as unknown as PrismaClientProvider,
    )

    await expect(
      repository.decidePending({
        id: requestId,
        decision: 'approved',
        decidedByUserId: reviewerId,
        decidedAt,
      }),
    ).resolves.toEqual({
      id: requestId,
      title: 'Atomic decision',
      description: 'The committed row is returned by the conditional update.',
      status: 'approved',
      createdByUserId: '38af083a-5aa7-4a69-935b-1f164733a53d',
      decidedByUserId: reviewerId,
      createdAt: new Date('2026-07-29T10:00:00.000Z'),
      decidedAt,
    })
    expect(admissions).toBe(1)
  })
})

function createRejectingRepository(
  error: unknown,
): PrismaApprovalRequestRepository {
  return new PrismaApprovalRequestRepository({
    withClient: jest.fn().mockRejectedValue(error),
  } as unknown as PrismaClientProvider)
}
