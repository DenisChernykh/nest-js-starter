import { defineProblemDefinition } from '@/platform/http/errors/problem-registry'

/** Public 404 returned for absent or visibility-hidden approval requests. */
export const APPROVAL_REQUEST_NOT_FOUND_PROBLEM = defineProblemDefinition({
  slug: 'approval-request-not-found',
  code: 'APPROVAL_REQUEST_NOT_FOUND',
  status: 404,
  title: 'Approval request not found',
  detail: 'The approval request does not exist.',
})

/** Public 409 returned when a terminal decision already exists. */
export const APPROVAL_REQUEST_ALREADY_DECIDED_PROBLEM = defineProblemDefinition(
  {
    slug: 'approval-request-already-decided',
    code: 'APPROVAL_REQUEST_ALREADY_DECIDED',
    status: 409,
    title: 'Approval request already decided',
    detail: 'A decision has already been recorded for this request.',
  },
)

/** Public 403 returned when an author attempts to review their own request. */
export const APPROVAL_SELF_DECISION_FORBIDDEN_PROBLEM = defineProblemDefinition(
  {
    slug: 'approval-self-decision-forbidden',
    code: 'APPROVAL_SELF_DECISION_FORBIDDEN',
    status: 403,
    title: 'Approval self-decision forbidden',
    detail: 'The author cannot decide their own approval request.',
  },
)

/** Complete immutable Problem Details catalog owned by approval requests. */
export const APPROVAL_REQUEST_PROBLEM_DEFINITIONS = Object.freeze([
  APPROVAL_REQUEST_NOT_FOUND_PROBLEM,
  APPROVAL_REQUEST_ALREADY_DECIDED_PROBLEM,
  APPROVAL_SELF_DECISION_FORBIDDEN_PROBLEM,
])
