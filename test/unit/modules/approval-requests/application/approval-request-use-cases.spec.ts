import {
  ApprovalRequestAlreadyDecidedError,
  ApprovalRequestNotFoundError,
  ApprovalSelfDecisionForbiddenError,
} from '@/modules/approval-requests/application/approval-request-errors'
import type { ApprovalRequestRepositoryPort } from '@/modules/approval-requests/application/approval-request-repository.port'
import { CreateApprovalRequestUseCase } from '@/modules/approval-requests/application/create-approval-request.use-case'
import { DecideApprovalRequestUseCase } from '@/modules/approval-requests/application/decide-approval-request.use-case'
import { GetApprovalRequestQuery } from '@/modules/approval-requests/application/get-approval-request.query'
import {
  createApprovalRequest,
  decideApprovalRequest,
  type ApprovalRequest,
} from '@/modules/approval-requests/domain/approval-request'

const requestId = 'approval-request-1'
const authorId = 'author-1'
const reviewerId = 'reviewer-1'
const strangerId = 'stranger-1'
const now = new Date('2026-07-29T08:00:00.000Z')
const later = new Date('2026-07-29T09:00:00.000Z')

function pendingRequest(): ApprovalRequest {
  return createApprovalRequest(
    {
      id: requestId,
      title: 'Publish July price list',
      description: 'Approve before publication.',
      createdByUserId: authorId,
    },
    now,
  )
}

function repositoryDouble(): jest.Mocked<ApprovalRequestRepositoryPort> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    decidePending: jest.fn(),
  }
}

describe('CreateApprovalRequestUseCase', () => {
  it('persists and returns one normalized pending aggregate', async () => {
    const repository = repositoryDouble()
    repository.create.mockImplementation((request) => Promise.resolve(request))
    const useCase = new CreateApprovalRequestUseCase(
      repository,
      () => requestId,
      () => now,
    )

    await expect(
      useCase.execute({
        actorUserId: authorId,
        title: '  Publish July price list  ',
        description: '  Approve before publication.  ',
      }),
    ).resolves.toMatchObject({
      id: requestId,
      title: 'Publish July price list',
      description: 'Approve before publication.',
      status: 'pending',
      createdByUserId: authorId,
      createdAt: now,
    })
    expect(repository.create.mock.calls).toEqual([
      [
        expect.objectContaining({
          id: requestId,
          title: 'Publish July price list',
          description: 'Approve before publication.',
          status: 'pending',
          createdByUserId: authorId,
          createdAt: now,
        }),
      ],
    ])
  })
})

describe('GetApprovalRequestQuery', () => {
  it('returns the author request without broad read access', async () => {
    const repository = repositoryDouble()
    const pending = pendingRequest()
    repository.findById.mockResolvedValue(pending)
    const query = new GetApprovalRequestQuery(repository)

    await expect(
      query.execute({
        actorUserId: authorId,
        requestId,
        mayReadAny: false,
      }),
    ).resolves.toBe(pending)
  })

  it('returns a foreign request when the actor may read any request', async () => {
    const repository = repositoryDouble()
    const pending = pendingRequest()
    repository.findById.mockResolvedValue(pending)
    const query = new GetApprovalRequestQuery(repository)

    await expect(
      query.execute({
        actorUserId: reviewerId,
        requestId,
        mayReadAny: true,
      }),
    ).resolves.toBe(pending)
  })

  it('hides a foreign request without broad read access', async () => {
    const repository = repositoryDouble()
    repository.findById.mockResolvedValue(pendingRequest())
    const query = new GetApprovalRequestQuery(repository)

    await expect(
      query.execute({
        actorUserId: strangerId,
        requestId,
        mayReadAny: false,
      }),
    ).rejects.toThrow(ApprovalRequestNotFoundError)
  })

  it('reports a missing request with the module not-found error', async () => {
    const repository = repositoryDouble()
    repository.findById.mockResolvedValue(undefined)
    const query = new GetApprovalRequestQuery(repository)

    await expect(
      query.execute({
        actorUserId: authorId,
        requestId,
        mayReadAny: false,
      }),
    ).rejects.toThrow(ApprovalRequestNotFoundError)
  })
})

describe('DecideApprovalRequestUseCase', () => {
  it('rejects self-decision before attempting the pending CAS', async () => {
    const repository = repositoryDouble()
    repository.findById.mockResolvedValue(pendingRequest())
    const useCase = new DecideApprovalRequestUseCase(repository, () => later)

    await expect(
      useCase.execute({
        actorUserId: authorId,
        requestId,
        decision: 'approved',
      }),
    ).rejects.toThrow(ApprovalSelfDecisionForbiddenError)
    expect(repository.decidePending.mock.calls).toHaveLength(0)
  })

  it('rejects an already terminal snapshot before attempting the pending CAS', async () => {
    const repository = repositoryDouble()
    repository.findById.mockResolvedValue(
      decideApprovalRequest(pendingRequest(), reviewerId, 'approved', later),
    )
    const useCase = new DecideApprovalRequestUseCase(repository, () => later)

    await expect(
      useCase.execute({
        actorUserId: strangerId,
        requestId,
        decision: 'rejected',
      }),
    ).rejects.toThrow(ApprovalRequestAlreadyDecidedError)
    expect(repository.decidePending.mock.calls).toHaveLength(0)
  })

  it('persists one terminal decision through the pending CAS', async () => {
    const repository = repositoryDouble()
    const approved = decideApprovalRequest(
      pendingRequest(),
      reviewerId,
      'approved',
      later,
    )
    repository.findById.mockResolvedValue(pendingRequest())
    repository.decidePending.mockResolvedValue(approved)
    const useCase = new DecideApprovalRequestUseCase(repository, () => later)

    await expect(
      useCase.execute({
        actorUserId: reviewerId,
        requestId,
        decision: 'approved',
      }),
    ).resolves.toBe(approved)
    expect(repository.decidePending.mock.calls).toEqual([
      [
        {
          id: requestId,
          decision: 'approved',
          decidedByUserId: reviewerId,
          decidedAt: later,
        },
      ],
    ])
  })

  it('reloads a lost compare-and-set and reports the terminal winner', async () => {
    const repository = repositoryDouble()
    const pending = pendingRequest()
    const approved = decideApprovalRequest(
      pending,
      reviewerId,
      'approved',
      later,
    )
    repository.decidePending.mockResolvedValueOnce(undefined)
    repository.findById
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(approved)
    const useCase = new DecideApprovalRequestUseCase(repository, () => later)

    await expect(
      useCase.execute({
        actorUserId: reviewerId,
        requestId,
        decision: 'rejected',
      }),
    ).rejects.toThrow(ApprovalRequestAlreadyDecidedError)
    expect(repository.findById.mock.calls).toHaveLength(2)
  })
})
