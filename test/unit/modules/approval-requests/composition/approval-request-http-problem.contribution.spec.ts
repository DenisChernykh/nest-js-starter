import {
  ApprovalRequestAlreadyDecidedError,
  ApprovalRequestNotFoundError,
  ApprovalSelfDecisionForbiddenError,
} from '@/modules/approval-requests/application/approval-request-errors'
import { APPROVAL_REQUEST_HTTP_PROBLEM_CONTRIBUTION } from '@/modules/approval-requests/composition/approval-request-http-problem.contribution'

describe('approval request HTTP problem contribution', () => {
  it.each([
    [
      new ApprovalRequestNotFoundError(),
      {
        slug: 'approval-request-not-found',
        code: 'APPROVAL_REQUEST_NOT_FOUND',
        status: 404,
        title: 'Approval request not found',
        detail: 'The approval request does not exist.',
      },
    ],
    [
      new ApprovalRequestAlreadyDecidedError(),
      {
        slug: 'approval-request-already-decided',
        code: 'APPROVAL_REQUEST_ALREADY_DECIDED',
        status: 409,
        title: 'Approval request already decided',
        detail: 'A decision has already been recorded for this request.',
      },
    ],
    [
      new ApprovalSelfDecisionForbiddenError(),
      {
        slug: 'approval-self-decision-forbidden',
        code: 'APPROVAL_SELF_DECISION_FORBIDDEN',
        status: 403,
        title: 'Approval self-decision forbidden',
        detail: 'The author cannot decide their own approval request.',
      },
    ],
  ] as const)(
    'maps the concrete module error to its registered public definition',
    (error, expectedDefinition) => {
      const definition =
        APPROVAL_REQUEST_HTTP_PROBLEM_CONTRIBUTION.definitions.find(
          ({ code }) => code === expectedDefinition.code,
        )

      expect(definition).toEqual({
        ...expectedDefinition,
        type: `https://nest-js-starter.invalid/problems/${expectedDefinition.slug}`,
      })
      expect(APPROVAL_REQUEST_HTTP_PROBLEM_CONTRIBUTION.map(error)).toEqual({
        code: expectedDefinition.code,
      })
    },
  )

  it('does not map an arbitrary object that copies a module error code', () => {
    expect(
      APPROVAL_REQUEST_HTTP_PROBLEM_CONTRIBUTION.map({
        code: 'APPROVAL_REQUEST_NOT_FOUND',
      }),
    ).toBeUndefined()
  })
})
