import type {
  ApprovalDecision,
  ApprovalRequest,
} from '../domain/approval-request'

/** Deterministic approval request identifier source. */
export type ApprovalRequestIdFactory = () => string

/** Deterministic wall-clock source for approval request state changes. */
export type ApprovalRequestClock = () => Date

/** Atomic terminal transition values accepted by approval persistence. */
export interface DecidePendingApprovalRequestInput {
  readonly id: string
  readonly decision: ApprovalDecision
  readonly decidedByUserId: string
  readonly decidedAt: Date
}

/**
 * Persistence boundary for request creation, visibility reads and decision CAS.
 *
 * @remarks
 * `decidePending` must update only a currently pending row and returns
 * `undefined` when the compare-and-set loses or the row is absent.
 */
export interface ApprovalRequestRepositoryPort {
  create(request: ApprovalRequest): Promise<ApprovalRequest>
  findById(id: string): Promise<ApprovalRequest | undefined>
  decidePending(
    input: DecidePendingApprovalRequestInput,
  ): Promise<ApprovalRequest | undefined>
}
