import {
  OutboxRelay,
  OutboxTerminalPublishError,
  OutboxTransientPublishError,
} from '@/platform/outbox/outbox-relay'
import type {
  ClaimedOutboxMessage,
  OutboxPublisherPort,
  OutboxStorePort,
} from '@/platform/outbox/outbox.ports'

function message(): ClaimedOutboxMessage {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    destination: 'notifications',
    type: 'inquiry.submitted',
    version: 1,
    occurredAt: new Date('2026-08-08T00:00:00.000Z'),
    payload: { inquiryId: 'inquiry-123' },
    attemptCount: 0,
    claimToken: '550e8400-e29b-41d4-a716-446655440001',
  }
}

function createHarness(): {
  readonly relay: OutboxRelay
  readonly markPublished: jest.Mock
  readonly scheduleRetry: jest.Mock
  readonly block: jest.Mock
  readonly publish: jest.Mock
} {
  const claim = jest.fn(() => Promise.resolve([message()]))
  const markPublished = jest.fn(() => Promise.resolve(undefined))
  const scheduleRetry = jest.fn(() => Promise.resolve(undefined))
  const block = jest.fn(() => Promise.resolve(undefined))
  const cleanupPublished = jest.fn(() => Promise.resolve(0))
  const diagnostics = jest.fn(() => Promise.resolve([]))
  const redrive = jest.fn(() => Promise.resolve(undefined))
  const publish = jest.fn(() => Promise.resolve(undefined))
  const store: OutboxStorePort = {
    claim,
    markPublished,
    scheduleRetry,
    block,
    cleanupPublished,
    diagnostics,
    redrive,
  }
  const publisher: OutboxPublisherPort = { publish }
  return {
    relay: new OutboxRelay(store, publisher, {
      destination: 'notifications',
      ownerId: 'relay-a',
      clock: () => new Date('2026-08-08T01:00:00.000Z'),
      random: () => 0.5,
    }),
    markPublished,
    scheduleRetry,
    block,
    publish,
  }
}

describe('OutboxRelay', () => {
  it('marks a successfully published claimed message', async () => {
    const { relay, markPublished, publish } = createHarness()

    await relay.runOnce()

    expect(publish).toHaveBeenCalledWith(message())
    expect(markPublished).toHaveBeenCalledWith({
      id: message().id,
      claimToken: message().claimToken,
      publishedAt: new Date('2026-08-08T01:00:00.000Z'),
    })
  })

  it('returns a transient publish failure to pending with full-jitter backoff', async () => {
    const { relay, publish, scheduleRetry } = createHarness()
    publish.mockRejectedValueOnce(new OutboxTransientPublishError('REDIS_DOWN'))

    await relay.runOnce()

    expect(scheduleRetry).toHaveBeenCalledWith({
      id: message().id,
      claimToken: message().claimToken,
      errorCode: 'REDIS_DOWN',
      nextAttemptAt: new Date('2026-08-08T01:00:00.500Z'),
    })
  })

  it('blocks a terminal publish failure without scheduling another attempt', async () => {
    const { relay, publish, block, scheduleRetry } = createHarness()
    publish.mockRejectedValueOnce(
      new OutboxTerminalPublishError('UNKNOWN_DESTINATION'),
    )

    await relay.runOnce()

    expect(block).toHaveBeenCalledWith({
      id: message().id,
      claimToken: message().claimToken,
      errorCode: 'UNKNOWN_DESTINATION',
      blockedAt: new Date('2026-08-08T01:00:00.000Z'),
    })
    expect(scheduleRetry).not.toHaveBeenCalled()
  })
})
