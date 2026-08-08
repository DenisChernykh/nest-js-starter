import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { PrismaTransactionContext } from '@/platform/database/prisma-transaction.context'

import {
  type OutboxMessageDraft,
  validateOutboxMessageDraft,
} from './outbox.contracts'

export interface OutboxMessage extends OutboxMessageDraft {
  readonly id: string
  readonly status: 'PENDING'
  readonly attemptCount: number
  readonly nextAttemptAt: Date
}

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
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async append(input: unknown): Promise<OutboxMessage> {
    if (!this.transactions.active) {
      throw new OutboxTransactionRequiredError()
    }
    const draft = validateOutboxMessageDraft(input)
    const id = this.createId()
    const nextAttemptAt = this.clock()
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
          status: 'PENDING',
          attemptCount: 0,
          nextAttemptAt,
        },
      }),
    )
    return Object.freeze({
      id,
      ...draft,
      status: 'PENDING' as const,
      attemptCount: 0,
      nextAttemptAt,
    })
  }
}
