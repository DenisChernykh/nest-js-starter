import { randomUUID } from 'node:crypto'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import type { DecidePendingApprovalRequestInput } from '@/modules/approval-requests/application/approval-request-repository.port'
import { createApprovalRequest } from '@/modules/approval-requests/domain/approval-request'
import { PrismaApprovalRequestRepository } from '@/modules/approval-requests/infrastructure/prisma-approval-request.repository'
import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { DatabaseUnavailableError } from '@/platform/database/database.contracts'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { runPrismaCommand } from '@test/integration/support/run-prisma-command'

describe('PrismaApprovalRequestRepository', () => {
  let container: StartedPostgreSqlContainer
  let provider: PrismaClientProvider
  let repository: PrismaApprovalRequestRepository
  let creatorId: string
  let reviewerId: string
  let databaseUrl: string

  function createProvider(): PrismaClientProvider {
    const environment = buildApiRuntimeConfig({
      DATABASE_URL: databaseUrl,
      REDIS_AUTH_URL: 'redis://default:test@127.0.0.1:6379',
      AUTH_SESSION_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url'),
      AUTH_CSRF_SECRET: Buffer.alloc(32, 2).toString('base64url'),
      AUTH_RATE_LIMIT_KEY_SECRET: Buffer.alloc(32, 3).toString('base64url'),
      AUTH_NETWORK_METADATA_SECRET: Buffer.alloc(32, 4).toString('base64url'),
    })
    return new PrismaClientProvider(
      new RuntimeConfigService(environment),
      new PrismaTransactionContext(),
    )
  }

  beforeAll(async () => {
    container = await startPostgresContainer()
    databaseUrl = container.getConnectionUri()
    const migration = runPrismaCommand(
      ['migrate', 'deploy', '--config', 'prisma.config.ts'],
      databaseUrl,
    )
    if (migration.exitCode !== 0)
      throw new Error('Approval request migration failed')
    provider = createProvider()
    repository = new PrismaApprovalRequestRepository(provider)
    await provider.connect(AbortSignal.timeout(2_000))
  })

  beforeEach(async () => {
    const users = await provider.withClient((client) =>
      client.user.createManyAndReturn({
        data: [
          {
            email: 'creator@example.com',
            normalizedEmail: 'creator@example.com',
          },
          {
            email: 'reviewer@example.com',
            normalizedEmail: 'reviewer@example.com',
          },
        ],
        select: { id: true, normalizedEmail: true },
      }),
    )
    creatorId = users.find(
      ({ normalizedEmail }) => normalizedEmail === 'creator@example.com',
    )!.id
    reviewerId = users.find(
      ({ normalizedEmail }) => normalizedEmail === 'reviewer@example.com',
    )!.id
  })

  afterEach(async () => {
    await provider.withClient(async (client) => {
      await client.approvalRequest.deleteMany()
      await client.user.deleteMany()
    })
  })

  afterAll(async () => {
    await provider.close(AbortSignal.timeout(2_000))
    await container.stop()
  })

  it('round-trips a pending snapshot with lowercase domain status', async () => {
    const createdAt = new Date('2026-07-28T21:01:02.345Z')
    const request = createApprovalRequest(
      {
        id: randomUUID(),
        title: '  Publish new reference  ',
        description: '  Verify the durable approval flow.  ',
        createdByUserId: creatorId,
      },
      createdAt,
    )

    const created = await repository.create(request)
    createdAt.setUTCFullYear(2030)

    expect(created).toEqual({
      id: request.id,
      title: 'Publish new reference',
      description: 'Verify the durable approval flow.',
      status: 'pending',
      createdByUserId: creatorId,
      createdAt: new Date('2026-07-28T21:01:02.345Z'),
    })
    await expect(repository.findById(request.id)).resolves.toEqual(created)
    await expect(repository.findById(randomUUID())).resolves.toBeUndefined()
  })

  it('allows exactly one concurrent pending decision and preserves its actor and time', async () => {
    const request = await repository.create(
      createApprovalRequest(
        {
          id: randomUUID(),
          title: 'Concurrent decision',
          description: 'Only one reviewer may win the pending transition.',
          createdByUserId: creatorId,
        },
        new Date('2026-07-28T21:02:00.000Z'),
      ),
    )
    const approveInput: DecidePendingApprovalRequestInput = {
      id: request.id,
      decision: 'approved',
      decidedByUserId: reviewerId,
      decidedAt: new Date('2026-07-28T21:03:00.000Z'),
    }
    const rejectInput: DecidePendingApprovalRequestInput = {
      id: request.id,
      decision: 'rejected',
      decidedByUserId: reviewerId,
      decidedAt: new Date('2026-07-28T21:04:00.000Z'),
    }

    const results = await Promise.all([
      repository.decidePending(approveInput),
      repository.decidePending(rejectInput),
    ])

    expect(results.filter((value) => value !== undefined)).toHaveLength(1)
    expect(results.filter((value) => value === undefined)).toHaveLength(1)
    const winner = results.find((value) => value !== undefined)
    expect(winner).toBeDefined()
    const stored = await provider.withClient((client) =>
      client.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }),
    )
    expect(stored.status).toBe(
      winner?.status === 'approved' ? 'APPROVED' : 'REJECTED',
    )
    expect(stored.decidedByUserId).toBe(winner?.decidedByUserId)
    expect(stored.decidedAt).toEqual(winner?.decidedAt)

    await expect(
      repository.decidePending({
        id: request.id,
        decision: 'approved',
        decidedByUserId: creatorId,
        decidedAt: new Date('2027-01-01T00:00:00.000Z'),
      }),
    ).resolves.toBeUndefined()
    await expect(repository.findById(request.id)).resolves.toEqual(winner)
  })

  it('translates closed-provider admission failure', async () => {
    const closedProvider = createProvider()
    await closedProvider.connect(AbortSignal.timeout(2_000))
    await closedProvider.close(AbortSignal.timeout(2_000))
    const closedRepository = new PrismaApprovalRequestRepository(closedProvider)

    await expect(
      closedRepository.findById(randomUUID()),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError)
  })
})
