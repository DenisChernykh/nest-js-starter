/** Lifecycle state owned by an approval request. */
export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected'

/** Terminal decision accepted for a pending approval request. */
export type ApprovalDecision = Exclude<ApprovalRequestStatus, 'pending'>

/** Immutable business snapshot of one approval request. */
export interface ApprovalRequest {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly status: ApprovalRequestStatus
  readonly createdByUserId: string
  readonly decidedByUserId?: string
  readonly createdAt: Date
  readonly decidedAt?: Date
}

/** Required caller-owned values for a new approval request. */
export interface CreateApprovalRequestInput {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly createdByUserId: string
}

/**
 * Creates a normalized pending snapshot without retaining mutable date state.
 *
 * @param input - Identity, author and user-provided content.
 * @param createdAt - Caller-owned creation time.
 * @returns A frozen snapshot whose date getter returns a defensive copy.
 * @throws RangeError when normalized content violates aggregate limits.
 */
export function createApprovalRequest(
  input: CreateApprovalRequestInput,
  createdAt: Date,
): ApprovalRequest {
  const title = input.title.trim()
  const description = input.description.trim()
  if (title.length === 0 || title.length > 120)
    throw new RangeError('Approval request title is outside allowed limits')
  if (description.length === 0 || description.length > 2_000)
    throw new RangeError(
      'Approval request description is outside allowed limits',
    )

  return immutableApprovalRequest({
    id: input.id,
    title,
    description,
    status: 'pending',
    createdByUserId: input.createdByUserId,
    createdAt,
  })
}

/**
 * Produces a terminal snapshot from a pending aggregate.
 *
 * @param request - Current pending snapshot already authorized by application policy.
 * @param decidedByUserId - Reviewer recording the terminal decision.
 * @param decision - Terminal status to persist.
 * @param decidedAt - Caller-owned decision time.
 * @returns A new frozen snapshot; the source snapshot remains unchanged.
 * @throws RangeError when called with a terminal snapshot.
 */
export function decideApprovalRequest(
  request: ApprovalRequest,
  decidedByUserId: string,
  decision: ApprovalDecision,
  decidedAt: Date,
): ApprovalRequest {
  if (request.status !== 'pending')
    throw new RangeError('Approval request is not pending')

  return immutableApprovalRequest({
    id: request.id,
    title: request.title,
    description: request.description,
    status: decision,
    createdByUserId: request.createdByUserId,
    createdAt: request.createdAt,
    decidedByUserId,
    decidedAt,
  })
}

function immutableApprovalRequest(
  request: Omit<ApprovalRequest, 'createdAt' | 'decidedAt'> & {
    readonly createdAt: Date
    readonly decidedAt?: Date
  },
): ApprovalRequest {
  const createdAtMs = request.createdAt.getTime()
  const decidedAtMs = request.decidedAt?.getTime()
  const snapshot: ApprovalRequest = {
    id: request.id,
    title: request.title,
    description: request.description,
    status: request.status,
    createdByUserId: request.createdByUserId,
    ...(request.decidedByUserId === undefined
      ? {}
      : { decidedByUserId: request.decidedByUserId }),
    get createdAt(): Date {
      return new Date(createdAtMs)
    },
  }
  if (decidedAtMs !== undefined)
    Object.defineProperty(snapshot, 'decidedAt', {
      enumerable: true,
      get: () => new Date(decidedAtMs),
    })
  return Object.freeze(snapshot)
}
