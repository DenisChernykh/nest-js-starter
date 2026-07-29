import { Injectable } from '@nestjs/common'

import type {
  ApprovalRequestRepositoryPort,
  DecidePendingApprovalRequestInput,
} from '../application/approval-request-repository.port'
import type { ApprovalRequest } from '../domain/approval-request'
import { mapPrismaApprovalRequest } from './prisma-approval-request.mapper'
import { DatabaseUnavailableError } from '@/platform/database/database.contracts'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'

/**
 * Prisma persistence adapter for approval-request snapshots.
 *
 * @remarks
 * The terminal transition is a pending-only compare-and-set. Infrastructure
 * failures are collapsed to the stable database-unavailable boundary.
 */
@Injectable()
export class PrismaApprovalRequestRepository implements ApprovalRequestRepositoryPort {
  public constructor(private readonly provider: PrismaClientProvider) {}

  public async create(request: ApprovalRequest): Promise<ApprovalRequest> {
    return this.runDatabaseOperation(async () => {
      const row = await this.provider.withClient((client) =>
        client.approvalRequest.create({
          data: {
            id: request.id,
            title: request.title,
            description: request.description,
            status: this.mapStatus(request.status),
            createdByUserId: request.createdByUserId,
            decidedByUserId: request.decidedByUserId ?? null,
            createdAt: new Date(request.createdAt),
            decidedAt:
              request.decidedAt === undefined
                ? null
                : new Date(request.decidedAt),
          },
        }),
      )
      return mapPrismaApprovalRequest(row)
    })
  }

  public async findById(id: string): Promise<ApprovalRequest | undefined> {
    return this.runDatabaseOperation(async () => {
      const row = await this.provider.withClient((client) =>
        client.approvalRequest.findUnique({ where: { id } }),
      )
      return row === null ? undefined : mapPrismaApprovalRequest(row)
    })
  }

  public async decidePending(
    input: DecidePendingApprovalRequestInput,
  ): Promise<ApprovalRequest | undefined> {
    return this.runDatabaseOperation(async () => {
      const result = await this.provider.withClient((client) =>
        client.approvalRequest.updateMany({
          where: { id: input.id, status: 'PENDING' },
          data: {
            status: input.decision === 'approved' ? 'APPROVED' : 'REJECTED',
            decidedByUserId: input.decidedByUserId,
            decidedAt: new Date(input.decidedAt),
          },
        }),
      )
      if (result.count === 0) return undefined
      if (result.count !== 1) throw new DatabaseUnavailableError()

      const row = await this.provider.withClient((client) =>
        client.approvalRequest.findUnique({ where: { id: input.id } }),
      )
      if (row === null) throw new DatabaseUnavailableError()
      return mapPrismaApprovalRequest(row)
    })
  }

  private mapStatus(
    status: ApprovalRequest['status'],
  ): 'PENDING' | 'APPROVED' | 'REJECTED' {
    switch (status) {
      case 'pending':
        return 'PENDING'
      case 'approved':
        return 'APPROVED'
      case 'rejected':
        return 'REJECTED'
    }
  }

  private async runDatabaseOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation()
    } catch {
      throw new DatabaseUnavailableError()
    }
  }
}
