import type { OutboxPublisherPort, OutboxStorePort } from './outbox.ports'
import { createOutboxMessageEnvelope } from './outbox.contracts'

export const outboxRelayDefaults = Object.freeze({
  batchSize: 50,
  leaseMs: 30_000,
  retryBaseMs: 1_000,
  retryMaxMs: 300_000,
})
export const OUTBOX_CLAIM_OWNER_MAX_LENGTH = 160

export class OutboxTransientPublishError extends Error {
  public constructor(public readonly code: string) {
    super(`Transient outbox publish failure: ${code}`)
    this.name = 'OutboxTransientPublishError'
  }
}

export class OutboxTerminalPublishError extends Error {
  public constructor(public readonly code: string) {
    super(`Terminal outbox publish failure: ${code}`)
    this.name = 'OutboxTerminalPublishError'
  }
}

export interface OutboxRelayOptions {
  readonly destination: string
  readonly ownerId: string
  readonly random?: () => number
  readonly batchSize?: number
  readonly leaseMs?: number
  readonly retryBaseMs?: number
  readonly retryMaxMs?: number
}

export class OutboxRelay {
  private readonly random: () => number
  private readonly batchSize: number
  private readonly leaseMs: number
  private readonly retryBaseMs: number
  private readonly retryMaxMs: number

  public constructor(
    private readonly store: OutboxStorePort,
    private readonly publisher: OutboxPublisherPort,
    private readonly options: OutboxRelayOptions,
  ) {
    if (
      options.ownerId.length === 0 ||
      options.ownerId.length > OUTBOX_CLAIM_OWNER_MAX_LENGTH ||
      options.ownerId.trim() !== options.ownerId
    ) {
      throw new Error('ownerId must contain between 1 and 160 characters')
    }
    this.random = options.random ?? Math.random
    this.batchSize = options.batchSize ?? outboxRelayDefaults.batchSize
    this.leaseMs = options.leaseMs ?? outboxRelayDefaults.leaseMs
    this.retryBaseMs = options.retryBaseMs ?? outboxRelayDefaults.retryBaseMs
    this.retryMaxMs = options.retryMaxMs ?? outboxRelayDefaults.retryMaxMs
  }

  public async runOnce(): Promise<void> {
    const messages = await this.store.claim({
      destination: this.options.destination,
      ownerId: this.options.ownerId,
      leaseMs: this.leaseMs,
      limit: this.batchSize,
    })
    for (const message of messages) {
      await this.publishClaimed(message)
    }
  }

  private async publishClaimed(
    message: Awaited<ReturnType<OutboxStorePort['claim']>>[number],
  ): Promise<void> {
    try {
      await this.publisher.publish(
        createOutboxMessageEnvelope(message.id, message),
        { redrivePublished: message.redrivePublished },
      )
      await this.store.markPublished({
        id: message.id,
        claimToken: message.claimToken,
      })
    } catch (error: unknown) {
      if (error instanceof OutboxTerminalPublishError) {
        await this.store.block({
          id: message.id,
          claimToken: message.claimToken,
          errorCode: safeErrorCode(
            error.code,
            'OUTBOX_TERMINAL_PUBLISH_FAILED',
          ),
        })
        return
      }
      const errorCode =
        error instanceof OutboxTransientPublishError
          ? safeErrorCode(error.code, 'OUTBOX_PUBLISH_FAILED')
          : 'OUTBOX_PUBLISH_FAILED'
      await this.store.scheduleRetry({
        id: message.id,
        claimToken: message.claimToken,
        errorCode,
        retryDelayMs: this.retryDelayMs(message.attemptCount),
      })
    }
  }

  private retryDelayMs(attemptCount: number): number {
    const cap = Math.min(
      this.retryMaxMs,
      this.retryBaseMs * 2 ** Math.max(0, attemptCount),
    )
    return Math.floor(cap * this.random())
  }
}

function safeErrorCode(value: string, fallback: string): string {
  return /^[A-Z][A-Z0-9_]{0,99}$/u.test(value) ? value : fallback
}
