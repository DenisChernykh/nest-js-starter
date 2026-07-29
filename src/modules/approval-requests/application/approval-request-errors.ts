import { ApplicationError } from '@/shared/application/application.error'

/** Stable framework-free failure codes owned by approval request policies. */
export type ApprovalRequestFailureCode =
  | 'APPROVAL_REQUEST_NOT_FOUND'
  | 'APPROVAL_REQUEST_ALREADY_DECIDED'
  | 'APPROVAL_SELF_DECISION_FORBIDDEN'

const NOT_FOUND_MESSAGE = 'Approval request not found'
const ALREADY_DECIDED_MESSAGE = 'Approval request is already decided'
const SELF_DECISION_MESSAGE =
  'Approval request author cannot decide their own request'

/** Base failure recognized by outer approval request adapters. */
export abstract class ApprovalRequestError extends ApplicationError<ApprovalRequestFailureCode> {
  protected constructor(
    code: ApprovalRequestFailureCode,
    internalMessage: string,
  ) {
    super(code, internalMessage)
    this.name = 'ApprovalRequestError'
  }
}

/** Missing request or a request intentionally hidden by visibility policy. */
export class ApprovalRequestNotFoundError extends ApprovalRequestError {
  public constructor() {
    super('APPROVAL_REQUEST_NOT_FOUND', NOT_FOUND_MESSAGE)
    this.name = 'ApprovalRequestNotFoundError'
  }
}

/** Terminal request that cannot accept another decision. */
export class ApprovalRequestAlreadyDecidedError extends ApprovalRequestError {
  public constructor() {
    super('APPROVAL_REQUEST_ALREADY_DECIDED', ALREADY_DECIDED_MESSAGE)
    this.name = 'ApprovalRequestAlreadyDecidedError'
  }
}

/** Request author attempting to approve or reject their own request. */
export class ApprovalSelfDecisionForbiddenError extends ApprovalRequestError {
  public constructor() {
    super('APPROVAL_SELF_DECISION_FORBIDDEN', SELF_DECISION_MESSAGE)
    this.name = 'ApprovalSelfDecisionForbiddenError'
  }
}
