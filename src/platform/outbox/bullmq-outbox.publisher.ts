import type { JobsOptions, JobState } from 'bullmq'

import { OutboxTransientPublishError } from './outbox-relay'
import type { OutboxMessageEnvelope } from './outbox.contracts'
import type { OutboxPublisherPort } from './outbox.ports'

export interface BullMqQueuePort {
  add(
    name: string,
    data: OutboxMessageEnvelope,
    options: JobsOptions,
  ): Promise<{
    getState(): Promise<JobState | 'unknown'>
    retry(state?: 'completed' | 'failed'): Promise<void>
  }>
}

export class BullMqOutboxPublisher implements OutboxPublisherPort {
  public constructor(private readonly queue: BullMqQueuePort) {}

  public async publish(
    message: OutboxMessageEnvelope,
    options: { readonly redrivePublished: boolean },
  ): Promise<void> {
    try {
      const job = await this.queue.add(message.type, message, {
        jobId: message.messageId,
      })
      if (options.redrivePublished) {
        const state = await job.getState()
        if (state === 'unknown') {
          throw new Error('BullMQ job state is indeterminate')
        }
        if (state === 'completed' || state === 'failed') {
          await job.retry(state)
        }
      }
    } catch {
      throw new OutboxTransientPublishError('BULLMQ_ENQUEUE_FAILED')
    }
  }
}
