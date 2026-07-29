import type { ApprovalRequest } from '../domain/approval-request'
import { ApprovalRequestNotFoundError } from './approval-request-errors'
import type { ApprovalRequestRepositoryPort } from './approval-request-repository.port'

/** Visibility context for reading one approval request. */
export interface GetApprovalRequestQueryInput {
  readonly actorUserId: string
  readonly requestId: string
  readonly mayReadAny: boolean
}

/**
 * Reads a request while hiding foreign state from unauthorized actors.
 *
 * @throws ApprovalRequestNotFoundError when the row is absent or hidden.
 */
export class GetApprovalRequestQuery {
  public constructor(
    private readonly repository: ApprovalRequestRepositoryPort,
  ) {}

  /**
   * Reads one request and applies author-or-broad-read visibility.
   *
   * @remarks
   * The query performs one repository read and propagates dependency failures
   * unchanged.
   *
   * @param input - Actor identity, target identity and broad-read decision.
   * @returns The repository snapshot when it is visible to the actor.
   * @throws ApprovalRequestNotFoundError when the request is absent or hidden.
   * @throws Error when the repository read fails.
   */
  public async execute(
    input: GetApprovalRequestQueryInput,
  ): Promise<ApprovalRequest> {
    const request = await this.repository.findById(input.requestId)
    if (
      request === undefined ||
      (!input.mayReadAny && request.createdByUserId !== input.actorUserId)
    )
      throw new ApprovalRequestNotFoundError()
    return request
  }
}
