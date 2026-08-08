import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

import { RuntimeConfigService } from '@/platform/config/runtime-config.service'
import { buildApiRuntimeConfig } from '@/platform/config/runtime-environment'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'
import { PrismaTransactionAdapter } from '@/platform/database/prisma-transaction.adapter'
import { PrismaOutboxStore } from '@/platform/outbox/prisma-outbox.store'
import {
  OUTBOX_MAX_VERSION,
  outboxPayloadSizeBytes,
} from '@/platform/outbox/outbox.contracts'
import { TransactionalOutboxWriter } from '@/platform/outbox/transactional-outbox.writer'
import { startPostgresContainer } from '@test/integration/support/postgres-container'
import { runPrismaCommand } from '@test/integration/support/run-prisma-command'
import { requiredRuntimeEnvironment } from '@test/support/required-runtime-environment'

describe('PrismaOutboxStore', () => {
  let container: StartedPostgreSqlContainer
  let provider: PrismaClientProvider
  let first: PrismaOutboxStore
  let second: PrismaOutboxStore
  let transaction: PrismaTransactionAdapter
  let writer: TransactionalOutboxWriter

  beforeAll(async () => {
    container = await startPostgresContainer()
    expect(
      runPrismaCommand(
        ['migrate', 'deploy', '--config', 'prisma.config.ts'],
        container.getConnectionUri(),
      ).exitCode,
    ).toBe(0)
    const config = new RuntimeConfigService(
      buildApiRuntimeConfig(
        requiredRuntimeEnvironment({
          DATABASE_URL: container.getConnectionUri(),
        }),
      ),
    )
    const context = new PrismaTransactionContext()
    provider = new PrismaClientProvider(config, context)
    transaction = new PrismaTransactionAdapter(provider, context, config)
    writer = new TransactionalOutboxWriter(provider, context)
    await provider.connect(AbortSignal.timeout(2_000))
    first = new PrismaOutboxStore(
      provider,
      () => '550e8400-e29b-41d4-a716-446655440001',
    )
    second = new PrismaOutboxStore(
      provider,
      () => '550e8400-e29b-41d4-a716-446655440002',
    )
  })

  afterEach(async () => {
    await provider?.withClient((client) => client.outboxMessage.deleteMany())
  })

  afterAll(async () => {
    await provider?.close(AbortSignal.timeout(2_000))
    await container?.stop()
  })

  async function seed(id: string): Promise<void> {
    await provider.withClient((client) =>
      client.outboxMessage.create({
        data: {
          id,
          destination: 'notifications',
          type: 'inquiry.submitted',
          version: 1,
          occurredAt: new Date('2026-08-08T00:00:00.000Z'),
          nextAttemptAt: new Date('2026-08-08T00:00:00.000Z'),
          payload: { inquiryId: id },
          payloadSizeBytes: outboxPayloadSizeBytes({ inquiryId: id }),
        },
      }),
    )
  }

  it('claims concurrent pending rows without duplicating a message', async () => {
    await seed('550e8400-e29b-41d4-a716-446655440010')
    await seed('550e8400-e29b-41d4-a716-446655440011')

    const [left, right] = await Promise.all([
      first.claim({
        destination: 'notifications',
        ownerId: 'first',
        leaseMs: 30_000,
        limit: 1,
      }),
      second.claim({
        destination: 'notifications',
        ownerId: 'second',
        leaseMs: 30_000,
        limit: 1,
      }),
    ])

    expect([...left, ...right].map((message) => message.id).sort()).toEqual([
      '550e8400-e29b-41d4-a716-446655440010',
      '550e8400-e29b-41d4-a716-446655440011',
    ])
  })

  it('commits an outbox append atomically with its owning transaction', async () => {
    await transaction.run(() =>
      writer.append({
        destination: 'notifications',
        type: 'inquiry.submitted',
        version: 1,
        occurredAt: new Date('2026-08-08T00:00:00.000Z'),
        payload: { inquiryId: 'committed' },
      }),
    )

    await expect(
      provider.withClient((client) => client.outboxMessage.count()),
    ).resolves.toBe(1)
  })

  it('persists a compact payload below 64 KiB even when jsonb text is larger', async () => {
    const payload = Object.fromEntries(
      Array.from({ length: 5_127 }, (_, index) => [`k${index}`, '']),
    )
    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeLessThan(
      64 * 1_024,
    )

    await expect(
      transaction.run(() =>
        writer.append({
          destination: 'notifications',
          type: 'payload.boundary',
          version: 1,
          occurredAt: new Date('2026-08-08T00:00:00.000Z'),
          payload,
        }),
      ),
    ).resolves.toBeDefined()
  })

  it('persists the maximum version supported by PostgreSQL INTEGER', async () => {
    const envelope = await transaction.run(() =>
      writer.append({
        destination: 'notifications',
        type: 'version.boundary',
        version: OUTBOX_MAX_VERSION,
        occurredAt: new Date('2026-08-08T00:00:00.000Z'),
        payload: {},
      }),
    )

    await expect(
      provider.withClient((client) =>
        client.outboxMessage.findUniqueOrThrow({
          where: { id: envelope.messageId },
          select: { version: true },
        }),
      ),
    ).resolves.toEqual({ version: OUTBOX_MAX_VERSION })
  })

  it('rolls an outbox append back with its owning transaction', async () => {
    await expect(
      transaction.run(async () => {
        await writer.append({
          destination: 'notifications',
          type: 'inquiry.submitted',
          version: 1,
          occurredAt: new Date('2026-08-08T00:00:00.000Z'),
          payload: { inquiryId: 'rolled-back' },
        })
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')

    await expect(
      provider.withClient((client) => client.outboxMessage.count()),
    ).resolves.toBe(0)
  })

  it('reclaims an expired lease and prevents its stale token from publishing', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440012'
    await seed(id)
    const [original] = await first.claim({
      destination: 'notifications',
      ownerId: 'first',
      leaseMs: 30_000,
      limit: 1,
    })
    if (original === undefined) throw new Error('outbox seed was not claimed')
    await provider.withClient((client) =>
      client.outboxMessage.update({
        where: { id },
        data: { claimedUntil: new Date(0) },
      }),
    )

    const [reclaimed] = await second.claim({
      destination: 'notifications',
      ownerId: 'second',
      leaseMs: 30_000,
      limit: 1,
    })
    if (reclaimed === undefined)
      throw new Error('expired lease was not reclaimed')

    await first.markPublished({
      id,
      claimToken: original.claimToken,
    })
    expect(
      (
        await provider.withClient((client) =>
          client.outboxMessage.findUniqueOrThrow({ where: { id } }),
        )
      ).status,
    ).toBe('CLAIMED')

    await second.markPublished({
      id,
      claimToken: reclaimed.claimToken,
    })
    expect(
      (
        await provider.withClient((client) =>
          client.outboxMessage.findUniqueOrThrow({ where: { id } }),
        )
      ).status,
    ).toBe('PUBLISHED')
    await expect(
      second.redrive({
        id,
        expectedStatus: 'PUBLISHED',
        allowDuplicate: false,
      }),
    ).rejects.toThrow('duplicate confirmation')
    await second.redrive({
      id,
      expectedStatus: 'PUBLISHED',
      allowDuplicate: true,
    })
    await expect(
      provider.withClient((client) =>
        client.outboxMessage.findUniqueOrThrow({ where: { id } }),
      ),
    ).resolves.toMatchObject({
      status: 'PENDING',
      redrivePublished: true,
    })
    const [publishedRedriveClaim] = await second.claim({
      destination: 'notifications',
      ownerId: 'second',
      leaseMs: 30_000,
      limit: 1,
    })
    expect(publishedRedriveClaim).toMatchObject({
      id,
      redrivePublished: true,
    })
    await expect(
      second.redrive({
        id,
        expectedStatus: 'PUBLISHED',
        allowDuplicate: true,
      }),
    ).rejects.toThrow('expected redrive state')
  })

  it('retries, blocks, redrives and cleans up without exposing payloads', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440013'
    await seed(id)
    const [firstClaim] = await first.claim({
      destination: 'notifications',
      ownerId: 'first',
      leaseMs: 30_000,
      limit: 1,
    })
    if (firstClaim === undefined) throw new Error('outbox seed was not claimed')
    await first.scheduleRetry({
      id,
      claimToken: firstClaim.claimToken,
      errorCode: 'REDIS_DOWN',
      retryDelayMs: 0,
    })
    const [retryClaim] = await first.claim({
      destination: 'notifications',
      ownerId: 'first',
      leaseMs: 30_000,
      limit: 1,
    })
    if (retryClaim === undefined) throw new Error('retry was not claimed')
    await first.block({
      id,
      claimToken: retryClaim.claimToken,
      errorCode: 'DESTINATION_DISABLED',
    })

    await expect(first.diagnostics()).resolves.toEqual([
      expect.objectContaining({
        destination: 'notifications',
        blockedCount: 1,
      }),
    ])
    await first.redrive({
      id,
      expectedStatus: 'BLOCKED',
      allowDuplicate: false,
    })
    const [redriven] = await first.claim({
      destination: 'notifications',
      ownerId: 'first',
      leaseMs: 30_000,
      limit: 1,
    })
    if (redriven === undefined) throw new Error('redrive was not claimed')
    await first.markPublished({
      id,
      claimToken: redriven.claimToken,
    })

    await expect(
      first.cleanupPublished({ retentionMs: 0, limit: 500 }),
    ).resolves.toBe(1)
    await expect(
      provider.withClient((client) =>
        client.outboxMessage.findUnique({ where: { id } }),
      ),
    ).resolves.toBeNull()
  })

  it('reports backlog age from message creation rather than retry schedule', async () => {
    const olderId = '550e8400-e29b-41d4-a716-446655440014'
    const newerId = '550e8400-e29b-41d4-a716-446655440015'
    await seed(olderId)
    await seed(newerId)
    await provider.withClient((client) =>
      client.$transaction([
        client.outboxMessage.update({
          where: { id: olderId },
          data: {
            createdAt: new Date('2026-08-01T00:00:00.000Z'),
            nextAttemptAt: new Date('2026-08-20T00:00:00.000Z'),
          },
        }),
        client.outboxMessage.update({
          where: { id: newerId },
          data: {
            createdAt: new Date('2026-08-02T00:00:00.000Z'),
            nextAttemptAt: new Date('2026-08-03T00:00:00.000Z'),
          },
        }),
      ]),
    )

    await expect(first.diagnostics()).resolves.toEqual([
      expect.objectContaining({
        destination: 'notifications',
        oldestPendingAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ])
  })
})
