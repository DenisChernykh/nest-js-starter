import {
  ApprovalRequestAlreadyDecidedError,
  ApprovalRequestNotFoundError,
  ApprovalSelfDecisionForbiddenError,
} from '../application/approval-request-errors'
import { APPROVAL_REQUEST_PROBLEM_DEFINITIONS } from '../presentation/approval-request-problem.definitions'
import type {
  HttpProblemContribution,
  HttpProblemMapping,
} from '@/platform/http/errors/problem.contracts'

/**
 * Module-owned public problem definitions and concrete error-class mapper.
 *
 * @remarks
 * The mapper recognizes only explicit approval-request error instances and
 * never trusts a structurally matching `code` property.
 */
export const APPROVAL_REQUEST_HTTP_PROBLEM_CONTRIBUTION: HttpProblemContribution =
  Object.freeze({
    definitions: APPROVAL_REQUEST_PROBLEM_DEFINITIONS,
    map: mapApprovalRequestProblem,
  })

function mapApprovalRequestProblem(
  error: unknown,
): HttpProblemMapping | undefined {
  if (error instanceof ApprovalRequestNotFoundError) {
    return { code: 'APPROVAL_REQUEST_NOT_FOUND' }
  }
  if (error instanceof ApprovalRequestAlreadyDecidedError) {
    return { code: 'APPROVAL_REQUEST_ALREADY_DECIDED' }
  }
  if (error instanceof ApprovalSelfDecisionForbiddenError) {
    return { code: 'APPROVAL_SELF_DECISION_FORBIDDEN' }
  }
  return undefined
}
