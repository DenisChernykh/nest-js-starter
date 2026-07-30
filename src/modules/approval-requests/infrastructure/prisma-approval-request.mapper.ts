import type {
  ApprovalRequest,
  ApprovalRequestStatus,
} from '../domain/approval-request'

interface ApprovalRequestRow {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED'
  readonly createdByUserId: string
  readonly decidedByUserId: string | null
  readonly createdAt: Date
  readonly decidedAt: Date | null
}

function mapStatus(
  status: ApprovalRequestRow['status'],
): ApprovalRequestStatus {
  switch (status) {
    case 'PENDING':
      return 'pending'
    case 'APPROVED':
      return 'approved'
    case 'REJECTED':
      return 'rejected'
  }
}

/**
 * Maps a generated-client row to an immutable framework-free domain snapshot.
 *
 * @param row - Complete persisted approval-request state.
 * @returns A frozen snapshot with lowercase status and defensive date copies.
 */
export function mapPrismaApprovalRequest(
  row: ApprovalRequestRow,
): ApprovalRequest {
  const createdAtMs = row.createdAt.getTime()
  const decidedAtMs = row.decidedAt?.getTime()
  const request: ApprovalRequest = {
    id: row.id,
    title: row.title,
    description: row.description,
    status: mapStatus(row.status),
    createdByUserId: row.createdByUserId,
    ...(row.decidedByUserId === null
      ? {}
      : { decidedByUserId: row.decidedByUserId }),
    get createdAt(): Date {
      return new Date(createdAtMs)
    },
  }
  if (decidedAtMs !== undefined)
    Object.defineProperty(request, 'decidedAt', {
      enumerable: true,
      get: () => new Date(decidedAtMs),
    })
  return Object.freeze(request)
}
