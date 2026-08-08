import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'

import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'

import type { JsonObject } from './outbox.contracts'
import type {
  ClaimedOutboxMessage,
  OutboxBacklogDiagnostic,
  OutboxStorePort,
} from './outbox.ports'

interface ClaimedOutboxRow {
  readonly id: string
  readonly destination: string
  readonly type: string
  readonly version: number
  readonly partitionKey: string | null
  readonly correlationId: string | null
  readonly occurredAt: Date
  readonly payload: JsonObject
  readonly attemptCount: number
  readonly claimToken: string
  readonly redrivePublished: boolean
}

interface DiagnosticRow {
  readonly destination: string
  readonly pendingCount: bigint
  readonly claimedCount: bigint
  readonly blockedCount: bigint
  readonly oldestPendingAt: Date | null
}

export class OutboxRedriveConfirmationRequiredError extends Error {
  public constructor() {
    super(
      'Redriving a published outbox message requires duplicate confirmation',
    )
    this.name = 'OutboxRedriveConfirmationRequiredError'
  }
}

export class OutboxRedriveConflictError extends Error {
  public constructor() {
    super('Outbox message was not found in the expected redrive state')
    this.name = 'OutboxRedriveConflictError'
  }
}

@Injectable()
export class PrismaOutboxStore implements OutboxStorePort {
  public constructor(
    private readonly provider: PrismaClientProvider,
    private readonly createClaimToken: () => string = randomUUID,
  ) {}

  public claim(input: {
    readonly destination: string
    readonly ownerId: string
    readonly leaseMs: number
    readonly limit: number
  }): Promise<readonly ClaimedOutboxMessage[]> {
    const claimToken = this.createClaimToken()
    return this.withRootTransaction(async (client) => {
      const rows = await client.$queryRaw<ClaimedOutboxRow[]>(Prisma.sql`
        WITH candidates AS (
          SELECT id
            FROM outbox_messages
           WHERE destination = ${input.destination}
             AND (
               (status = 'PENDING' AND next_attempt_at <= CURRENT_TIMESTAMP)
               OR (status = 'CLAIMED' AND claimed_until <= CURRENT_TIMESTAMP)
             )
           ORDER BY next_attempt_at ASC, created_at ASC, id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT ${input.limit}
        )
        UPDATE outbox_messages AS message
           SET status = 'CLAIMED',
               claim_token = ${claimToken}::uuid,
               claimed_by = ${input.ownerId},
               claimed_until = CURRENT_TIMESTAMP + (${input.leaseMs} * INTERVAL '1 millisecond'),
               updated_at = CURRENT_TIMESTAMP
          FROM candidates
         WHERE message.id = candidates.id
        RETURNING message.id,
                  message.destination,
                  message.type,
                  message.version,
                  message.partition_key AS "partitionKey",
                  message.correlation_id AS "correlationId",
                  message.occurred_at AS "occurredAt",
                  message.payload,
                  message.attempt_count AS "attemptCount",
                  message.claim_token::text AS "claimToken",
                  message.redrive_published AS "redrivePublished"
      `)
      return rows.map((row) => this.toClaimedMessage(row))
    })
  }

  public async markPublished(input: {
    readonly id: string
    readonly claimToken: string
  }): Promise<void> {
    await this.provider.withClient((client) =>
      client.$executeRaw(Prisma.sql`
        UPDATE outbox_messages
           SET status = 'PUBLISHED',
               published_at = CURRENT_TIMESTAMP,
               claimed_until = NULL,
               claim_token = NULL,
               claimed_by = NULL,
               last_error_code = NULL,
               redrive_published = false,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ${input.id}::uuid
           AND status = 'CLAIMED'
           AND claim_token = ${input.claimToken}::uuid
      `),
    )
  }

  public async scheduleRetry(input: {
    readonly id: string
    readonly claimToken: string
    readonly errorCode: string
    readonly retryDelayMs: number
  }): Promise<void> {
    await this.provider.withClient((client) =>
      client.$executeRaw(Prisma.sql`
        UPDATE outbox_messages
           SET status = 'PENDING',
               attempt_count = attempt_count + 1,
               next_attempt_at = CURRENT_TIMESTAMP + (${input.retryDelayMs} * INTERVAL '1 millisecond'),
               claimed_until = NULL,
               claim_token = NULL,
               claimed_by = NULL,
               last_error_code = ${input.errorCode},
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ${input.id}::uuid
           AND status = 'CLAIMED'
           AND claim_token = ${input.claimToken}::uuid
      `),
    )
  }

  public async block(input: {
    readonly id: string
    readonly claimToken: string
    readonly errorCode: string
  }): Promise<void> {
    await this.provider.withClient((client) =>
      client.$executeRaw(Prisma.sql`
        UPDATE outbox_messages
           SET status = 'BLOCKED',
               blocked_at = CURRENT_TIMESTAMP,
               claimed_until = NULL,
               claim_token = NULL,
               claimed_by = NULL,
               last_error_code = ${input.errorCode},
               redrive_published = false,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ${input.id}::uuid
           AND status = 'CLAIMED'
           AND claim_token = ${input.claimToken}::uuid
      `),
    )
  }

  public async cleanupPublished(input: {
    readonly retentionMs: number
    readonly limit: number
  }): Promise<number> {
    const rows = await this.withRootTransaction((client) =>
      client.$queryRaw<Array<{ readonly id: string }>>(Prisma.sql`
        WITH candidates AS (
          SELECT id
            FROM outbox_messages
           WHERE status = 'PUBLISHED'
             AND published_at < CURRENT_TIMESTAMP - (${input.retentionMs} * INTERVAL '1 millisecond')
           ORDER BY published_at ASC, id ASC
           LIMIT ${input.limit}
           FOR UPDATE SKIP LOCKED
        )
        DELETE FROM outbox_messages AS message
         USING candidates
         WHERE message.id = candidates.id
        RETURNING message.id
      `),
    )
    return rows.length
  }

  public async diagnostics(): Promise<readonly OutboxBacklogDiagnostic[]> {
    const rows = await this.provider.withClient((client) =>
      client.$queryRaw<DiagnosticRow[]>(Prisma.sql`
        SELECT destination,
               count(*) FILTER (WHERE status = 'PENDING') AS "pendingCount",
               count(*) FILTER (WHERE status = 'CLAIMED') AS "claimedCount",
               count(*) FILTER (WHERE status = 'BLOCKED') AS "blockedCount",
               min(created_at) FILTER (WHERE status = 'PENDING') AS "oldestPendingAt"
          FROM outbox_messages
         WHERE status IN ('PENDING', 'CLAIMED', 'BLOCKED')
         GROUP BY destination
         ORDER BY destination ASC
      `),
    )
    return rows.map((row) => ({
      destination: row.destination,
      pendingCount: Number(row.pendingCount),
      claimedCount: Number(row.claimedCount),
      blockedCount: Number(row.blockedCount),
      ...(row.oldestPendingAt === null
        ? {}
        : { oldestPendingAt: row.oldestPendingAt }),
    }))
  }

  public async redrive(input: {
    readonly id: string
    readonly expectedStatus: 'BLOCKED' | 'PUBLISHED'
    readonly allowDuplicate: boolean
  }): Promise<void> {
    if (input.expectedStatus === 'PUBLISHED' && !input.allowDuplicate) {
      throw new OutboxRedriveConfirmationRequiredError()
    }
    const changed = await this.provider.withClient((client) =>
      input.expectedStatus === 'PUBLISHED'
        ? client.$executeRaw(Prisma.sql`
            UPDATE outbox_messages
               SET status = 'PENDING',
                   next_attempt_at = CURRENT_TIMESTAMP,
                   published_at = NULL,
                   last_error_code = NULL,
                   redrive_published = true,
                   updated_at = CURRENT_TIMESTAMP
             WHERE id = ${input.id}::uuid
               AND status = 'PUBLISHED'
          `)
        : client.$executeRaw(Prisma.sql`
            UPDATE outbox_messages
               SET status = 'PENDING',
                   next_attempt_at = CURRENT_TIMESTAMP,
                   blocked_at = NULL,
                   last_error_code = NULL,
                   redrive_published = false,
                   updated_at = CURRENT_TIMESTAMP
             WHERE id = ${input.id}::uuid
               AND status = 'BLOCKED'
          `),
    )
    if (changed !== 1) {
      throw new OutboxRedriveConflictError()
    }
  }

  private async withRootTransaction<T>(
    operation: (client: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.provider.withClient(async (client) => {
      const root = client as PrismaClient
      return root.$transaction((transaction) => operation(transaction))
    })
  }

  private toClaimedMessage(row: ClaimedOutboxRow): ClaimedOutboxMessage {
    return Object.freeze({
      id: row.id,
      destination: row.destination,
      type: row.type,
      version: row.version,
      ...(row.partitionKey === null ? {} : { partitionKey: row.partitionKey }),
      ...(row.correlationId === null
        ? {}
        : { correlationId: row.correlationId }),
      occurredAt: row.occurredAt,
      payload: row.payload,
      attemptCount: row.attemptCount,
      claimToken: row.claimToken,
      redrivePublished: row.redrivePublished,
    })
  }
}
