import { randomUUID } from 'node:crypto'
import {
  createApprovalRequest,
  type ApprovalRequest,
} from '../domain/approval-request'
import type {
  ApprovalRequestClock,
  ApprovalRequestIdFactory,
  ApprovalRequestRepositoryPort,
} from './approval-request-repository.port'

/** Caller-owned values required to create an approval request. */
export interface CreateApprovalRequestUseCaseInput {
  readonly actorUserId: string
  readonly title: string
  readonly description: string
}

/**
 * Creates and persists one normalized pending approval request.
 *
 * @throws RangeError when request content violates aggregate limits.
 */
export class CreateApprovalRequestUseCase {
  public constructor(
    private readonly repository: ApprovalRequestRepositoryPort,
    private readonly idFactory: ApprovalRequestIdFactory = randomUUID,
    private readonly clock: ApprovalRequestClock = () => new Date(),
  ) {}

  public execute(
    input: CreateApprovalRequestUseCaseInput,
  ): Promise<ApprovalRequest> {
    const request = createApprovalRequest(
      {
        id: this.idFactory(),
        title: input.title,
        description: input.description,
        createdByUserId: input.actorUserId,
      },
      this.clock(),
    )
    return this.repository.create(request)
  }
}
