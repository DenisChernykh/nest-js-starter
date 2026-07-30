import {
  decideApprovalRequest,
  type ApprovalDecision,
  type ApprovalRequest,
} from '../domain/approval-request'
import {
  ApprovalRequestAlreadyDecidedError,
  ApprovalRequestNotFoundError,
  ApprovalSelfDecisionForbiddenError,
} from './approval-request-errors'
import type {
  ApprovalRequestClock,
  ApprovalRequestRepositoryPort,
} from './approval-request-repository.port'

/** Actor, target and terminal value required by the decision operation. */
export interface DecideApprovalRequestUseCaseInput {
  readonly actorUserId: string
  readonly requestId: string
  readonly decision: ApprovalDecision
}

/**
 * Applies author and lifecycle policy before an atomic pending-only decision.
 *
 * @remarks
 * A lost compare-and-set is reloaded so the stable failure reflects the
 * durable winner instead of the stale snapshot.
 *
 * @throws ApprovalRequestNotFoundError when the target is absent.
 * @throws ApprovalRequestAlreadyDecidedError when terminal state wins.
 * @throws ApprovalSelfDecisionForbiddenError when the author decides.
 */
export class DecideApprovalRequestUseCase {
  public constructor(
    private readonly repository: ApprovalRequestRepositoryPort,
    private readonly clock: ApprovalRequestClock = () => new Date(),
  ) {}

  /**
   * Decides a visible pending snapshot through the repository CAS boundary.
   *
   * @remarks
   * The operation attempts one pending-only compare-and-set. A lost CAS causes
   * one reload for outcome classification, not a retry. A terminal reload is
   * reported as already decided; a still-pending reload is an internal
   * invariant failure. No stronger atomicity or durability is implied beyond
   * the repository port.
   *
   * @param input - Reviewer identity, target identity and terminal decision.
   * @returns The terminal snapshot returned by a successful pending-only CAS.
   * @throws ApprovalRequestNotFoundError when the target is absent initially or after reload.
   * @throws ApprovalRequestAlreadyDecidedError when initial or reloaded state is terminal.
   * @throws ApprovalSelfDecisionForbiddenError when the actor authored the request.
   * @throws Error when a dependency fails or a lost-CAS reload remains pending.
   */
  public async execute(
    input: DecideApprovalRequestUseCaseInput,
  ): Promise<ApprovalRequest> {
    const current = await this.repository.findById(input.requestId)
    if (current === undefined) throw new ApprovalRequestNotFoundError()
    assertApprovalDecisionAllowed(current, input.actorUserId)

    const decidedAt = this.clock()
    const candidate = decideApprovalRequest(
      current,
      input.actorUserId,
      input.decision,
      decidedAt,
    )
    const persisted = await this.repository.decidePending({
      id: candidate.id,
      decision: input.decision,
      decidedByUserId: input.actorUserId,
      decidedAt,
    })
    if (persisted !== undefined) return persisted

    const reloaded = await this.repository.findById(input.requestId)
    if (reloaded === undefined) throw new ApprovalRequestNotFoundError()
    assertApprovalDecisionAllowed(reloaded, input.actorUserId)
    throw new Error('Approval request pending CAS invariant violated')
  }
}

function assertApprovalDecisionAllowed(
  request: ApprovalRequest,
  actorUserId: string,
): void {
  if (request.status !== 'pending')
    throw new ApprovalRequestAlreadyDecidedError()
  if (request.createdByUserId === actorUserId)
    throw new ApprovalSelfDecisionForbiddenError()
}
