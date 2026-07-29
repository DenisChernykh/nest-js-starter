/**
 * @packageDocumentation
 * Framework-free approval request contracts available to other business
 * modules.
 */
export type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRequestStatus,
} from './domain/approval-request'
export type { ApprovalRequestFailureCode } from './application/approval-request-errors'
export {
  ApprovalRequestAlreadyDecidedError,
  ApprovalRequestError,
  ApprovalRequestNotFoundError,
  ApprovalSelfDecisionForbiddenError,
} from './application/approval-request-errors'
