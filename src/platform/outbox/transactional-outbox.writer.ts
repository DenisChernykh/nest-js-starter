import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'

import {
  createOutboxMessageEnvelope,
  outboxPayloadSizeBytes,
  type OutboxMessageEnvelope,
  validateOutboxMessageDraft,
} from './outbox.contracts'

export class OutboxTransactionRequiredError extends Error {
  public constructor() {
    super('Transactional outbox append requires an active transaction')
    this.name = 'OutboxTransactionRequiredError'
  }
}

@Injectable()
export class TransactionalOutboxWriter {
  public constructor(
    private readonly provider: PrismaClientProvider,
    private readonly transactions: PrismaTransactionContext,
    private readonly createId: () => string = randomUUID,
  ) {}

  public async append(input: unknown): Promise<OutboxMessageEnvelope> {
    if (!this.transactions.active) {
      throw new OutboxTransactionRequiredError()
    }
    const draft = validateOutboxMessageDraft(input)
    const id = this.createId()
    await this.provider.withClient((client) =>
      client.outboxMessage.create({
        data: {
          id,
          destination: draft.destination,
          type: draft.type,
          version: draft.version,
          ...(draft.partitionKey === undefined
            ? {}
            : { partitionKey: draft.partitionKey }),
          ...(draft.correlationId === undefined
            ? {}
            : { correlationId: draft.correlationId }),
          occurredAt: draft.occurredAt,
          payload: draft.payload,
          payloadSizeBytes: outboxPayloadSizeBytes(draft.payload),
          status: 'PENDING',
          attemptCount: 0,
        },
      }),
    )
    return createOutboxMessageEnvelope(id, draft)
  }
}
