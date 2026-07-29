import { DatabaseUnavailableError } from '@/platform/database/database.contracts'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaApprovalRequestRepository } from '@/modules/approval-requests/infrastructure/prisma-approval-request.repository'

describe('PrismaApprovalRequestRepository error boundary', () => {
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
