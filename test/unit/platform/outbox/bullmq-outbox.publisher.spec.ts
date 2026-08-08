import { BullMqOutboxPublisher } from '@/platform/outbox/bullmq-outbox.publisher'
import { OutboxTransientPublishError } from '@/platform/outbox/outbox-relay'
import type { OutboxMessageEnvelope } from '@/platform/outbox/outbox.contracts'

const message: OutboxMessageEnvelope = {
  messageId: '550e8400-e29b-41d4-a716-446655440000',
  destination: 'notifications',
  type: 'inquiry.submitted',
  version: 1,
  occurredAt: '2026-08-08T00:00:00.000Z',
  payload: { inquiryId: 'inquiry-123' },
}

describe('BullMqOutboxPublisher', () => {
  it('enqueues the canonical envelope under the stable outbox message id', async () => {
    const queue = {
      add: jest.fn(() =>
        Promise.resolve({
          getState: () => Promise.resolve('waiting' as const),
          retry: () => Promise.resolve(undefined),
        }),
      ),
    }
    const publisher = new BullMqOutboxPublisher(queue)

    await publisher.publish(message, { redrivePublished: false })

    expect(queue.add).toHaveBeenCalledWith(message.type, message, {
      jobId: message.messageId,
    })
  })

  it('turns BullMQ enqueue errors into a safe retryable outbox failure', async () => {
    const queue = { add: jest.fn(() => Promise.reject(new Error('secret'))) }
    const publisher = new BullMqOutboxPublisher(queue)

    await expect(
      publisher.publish(message, { redrivePublished: false }),
    ).rejects.toEqual(new OutboxTransientPublishError('BULLMQ_ENQUEUE_FAILED'))
  })

  it('retries a retained completed job for an explicitly confirmed published redrive', async () => {
    const retry = jest.fn(() => Promise.resolve(undefined))
    const queue = {
      add: jest.fn(() =>
        Promise.resolve({
          getState: () => Promise.resolve('completed' as const),
          retry,
        }),
      ),
    }
    const publisher = new BullMqOutboxPublisher(queue)

    await publisher.publish(message, { redrivePublished: true })

    expect(retry).toHaveBeenCalledWith('completed')
  })

  it('fails transiently when a published-redrive job disappears concurrently', async () => {
    const queue = {
      add: jest.fn(() =>
        Promise.resolve({
          getState: () => Promise.resolve('unknown' as const),
          retry: () => Promise.resolve(undefined),
        }),
      ),
    }
    const publisher = new BullMqOutboxPublisher(queue)

    await expect(
      publisher.publish(message, { redrivePublished: true }),
    ).rejects.toEqual(new OutboxTransientPublishError('BULLMQ_ENQUEUE_FAILED'))
  })
})
