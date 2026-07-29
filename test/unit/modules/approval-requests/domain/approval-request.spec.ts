import {
  createApprovalRequest,
  decideApprovalRequest,
  type ApprovalRequest,
} from '@/modules/approval-requests/domain/approval-request'

const id = 'approval-request-1'
const authorId = 'author-1'
const reviewerId = 'reviewer-1'
const now = new Date('2026-07-29T08:00:00.000Z')

describe('approval request domain', () => {
  it('creates a normalized pending request', () => {
    expect(
      createApprovalRequest(
        {
          id,
          title: '  Publish July price list  ',
          description: '  Approve before publication.  ',
          createdByUserId: authorId,
        },
        now,
      ),
    ).toMatchObject({
      id,
      title: 'Publish July price list',
      description: 'Approve before publication.',
      status: 'pending',
      createdByUserId: authorId,
      createdAt: now,
    })
  })

  it.each([
    ['an empty title', '', 'description'],
    ['an empty description', 'title', '   '],
    ['a title longer than 120 characters', 't'.repeat(121), 'description'],
    ['a description longer than 2,000 characters', 'title', 'd'.repeat(2_001)],
  ])(
    'rejects %s as a programmer-contract failure',
    (_name, title, description) => {
      expect(() =>
        createApprovalRequest(
          { id, title, description, createdByUserId: authorId },
          now,
        ),
      ).toThrow(RangeError)
    },
  )

  it('preserves internal whitespace while trimming aggregate edges', () => {
    const request = createApprovalRequest(
      {
        id,
        title: '  Publish   July price list  ',
        description: '  Approve\n\nbefore publication.  ',
        createdByUserId: authorId,
      },
      now,
    )

    expect(request.title).toBe('Publish   July price list')
    expect(request.description).toBe('Approve\n\nbefore publication.')
  })

  it('does not expose mutable date state on creation', () => {
    const sourceDate = new Date(now)
    const request = createApprovalRequest(
      {
        id,
        title: 'Title',
        description: 'Description',
        createdByUserId: authorId,
      },
      sourceDate,
    )

    sourceDate.setUTCFullYear(2030)
    const exposedDate = request.createdAt
    exposedDate.setUTCFullYear(2040)

    expect(request.createdAt).toEqual(now)
    expect(Object.isFrozen(request)).toBe(true)
  })

  it('returns a new immutable terminal snapshot without mutating pending state', () => {
    const pending = createApprovalRequest(
      {
        id,
        title: 'Title',
        description: 'Description',
        createdByUserId: authorId,
      },
      now,
    )
    const decidedAt = new Date('2026-07-29T09:00:00.000Z')

    const approved = decideApprovalRequest(
      pending,
      reviewerId,
      'approved',
      decidedAt,
    )
    decidedAt.setUTCFullYear(2030)
    const exposedDate = approved.decidedAt
    exposedDate?.setUTCFullYear(2040)

    expect(approved).toMatchObject({
      status: 'approved',
      decidedByUserId: reviewerId,
      decidedAt: new Date('2026-07-29T09:00:00.000Z'),
    })
    expect(pending.status).toBe('pending')
    expect(approved.decidedAt).toEqual(new Date('2026-07-29T09:00:00.000Z'))
    expect(Object.isFrozen(approved)).toBe(true)
  })

  it('rejects a terminal snapshot as an invalid domain transition', () => {
    const terminal = {
      ...createApprovalRequest(
        {
          id,
          title: 'Title',
          description: 'Description',
          createdByUserId: authorId,
        },
        now,
      ),
      status: 'approved',
      decidedByUserId: reviewerId,
      decidedAt: now,
    } satisfies ApprovalRequest

    expect(() =>
      decideApprovalRequest(terminal, reviewerId, 'rejected', now),
    ).toThrow(RangeError)
  })
})
