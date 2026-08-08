import type { JobsOptions } from 'bullmq'

import { OutboxTransientPublishError } from './outbox-relay'
import type { ClaimedOutboxMessage, OutboxPublisherPort } from './outbox.ports'

export interface BullMqQueuePort {
  add(
    name: string,
    data: ClaimedOutboxMessage,
    options: JobsOptions,
  ): Promise<unknown>
}

export class BullMqOutboxPublisher implements OutboxPublisherPort {
  public constructor(private readonly queue: BullMqQueuePort) {}

  public async publish(message: ClaimedOutboxMessage): Promise<void> {
    try {
      await this.queue.add(message.type, message, { jobId: message.id })
    } catch {
      throw new OutboxTransientPublishError('BULLMQ_ENQUEUE_FAILED')
    }
  }
}
