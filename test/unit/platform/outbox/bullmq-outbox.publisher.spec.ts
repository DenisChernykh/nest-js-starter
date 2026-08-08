import { BullMqOutboxPublisher } from '@/platform/outbox/bullmq-outbox.publisher'
import { OutboxTransientPublishError } from '@/platform/outbox/outbox-relay'
import type { ClaimedOutboxMessage } from '@/platform/outbox/outbox.ports'

const message: ClaimedOutboxMessage = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  destination: 'notifications',
  type: 'inquiry.submitted',
  version: 1,
  occurredAt: new Date('2026-08-08T00:00:00.000Z'),
  payload: { inquiryId: 'inquiry-123' },
  attemptCount: 0,
  claimToken: '550e8400-e29b-41d4-a716-446655440001',
}

describe('BullMqOutboxPublisher', () => {
  it('enqueues the canonical envelope under the stable outbox message id', async () => {
    const queue = { add: jest.fn(() => Promise.resolve(undefined)) }
    const publisher = new BullMqOutboxPublisher(queue)

    await publisher.publish(message)

    expect(queue.add).toHaveBeenCalledWith(message.type, message, {
      jobId: message.id,
    })
  })

  it('turns BullMQ enqueue errors into a safe retryable outbox failure', async () => {
    const queue = { add: jest.fn(() => Promise.reject(new Error('secret'))) }
    const publisher = new BullMqOutboxPublisher(queue)

    await expect(publisher.publish(message)).rejects.toEqual(
      new OutboxTransientPublishError('BULLMQ_ENQUEUE_FAILED'),
    )
  })
})
