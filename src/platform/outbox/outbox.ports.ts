import type { JsonObject } from './outbox.contracts'

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
    readonly publishedAt: Date
  }): Promise<void>
  scheduleRetry(input: {
    readonly id: string
    readonly claimToken: string
    readonly errorCode: string
    readonly nextAttemptAt: Date
  }): Promise<void>
  block(input: {
    readonly id: string
    readonly claimToken: string
    readonly errorCode: string
    readonly blockedAt: Date
  }): Promise<void>
  cleanupPublished(input: {
    readonly before: Date
    readonly limit: number
  }): Promise<number>
  diagnostics(): Promise<readonly OutboxBacklogDiagnostic[]>
  redrive(input: {
    readonly id: string
    readonly expectedStatus: 'BLOCKED' | 'PUBLISHED'
    readonly allowDuplicate: boolean
    readonly nextAttemptAt: Date
  }): Promise<void>
}

export interface OutboxPublisherPort {
  publish(message: ClaimedOutboxMessage): Promise<void>
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
