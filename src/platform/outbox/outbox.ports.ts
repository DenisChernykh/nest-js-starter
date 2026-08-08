import type { JsonObject, OutboxMessageEnvelope } from './outbox.contracts'

export interface ClaimedOutboxMessage {
  readonly id: string
  readonly destination: string
  readonly type: string
  readonly version: number
  readonly partitionKey?: string
  readonly correlationId?: string
  readonly occurredAt: Date
  readonly payload: JsonObject
  readonly attemptCount: number
  readonly claimToken: string
  readonly redrivePublished: boolean
}

export interface OutboxStorePort {
  claim(input: {
    readonly destination: string
    readonly ownerId: string
    readonly leaseMs: number
    readonly limit: number
  }): Promise<readonly ClaimedOutboxMessage[]>
  markPublished(input: {
    readonly id: string
    readonly claimToken: string
  }): Promise<void>
  scheduleRetry(input: {
    readonly id: string
    readonly claimToken: string
    readonly errorCode: string
    readonly retryDelayMs: number
  }): Promise<void>
  block(input: {
    readonly id: string
    readonly claimToken: string
    readonly errorCode: string
  }): Promise<void>
  cleanupPublished(input: {
    readonly retentionMs: number
    readonly limit: number
  }): Promise<number>
  diagnostics(): Promise<readonly OutboxBacklogDiagnostic[]>
  redrive(input: {
    readonly id: string
    readonly expectedStatus: 'BLOCKED' | 'PUBLISHED'
    readonly allowDuplicate: boolean
  }): Promise<void>
}

export interface OutboxPublisherPort {
  publish(
    message: OutboxMessageEnvelope,
    options: { readonly redrivePublished: boolean },
  ): Promise<void>
}

export interface OutboxBacklogDiagnostic {
  readonly destination: string
  readonly pendingCount: number
  readonly claimedCount: number
  readonly blockedCount: number
  readonly oldestPendingAt?: Date
}

export const OUTBOX_STORE: unique symbol = Symbol('OUTBOX_STORE')
export const OUTBOX_PUBLISHER: unique symbol = Symbol('OUTBOX_PUBLISHER')
