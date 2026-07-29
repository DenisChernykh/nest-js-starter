import { Injectable } from '@nestjs/common'

import { Prisma } from '@/generated/prisma/client'
import { DatabaseUnavailableError } from '@/platform/database/database.contracts'
import type { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import type {
  ApprovalRequestRepositoryPort,
  DecidePendingApprovalRequestInput,
} from '../application/approval-request-repository.port'
import type { ApprovalRequest } from '../domain/approval-request'
import { mapPrismaApprovalRequest } from './prisma-approval-request.mapper'

const databaseUnavailablePrismaCodes = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2037',
])

class UnexpectedDatabaseOperationError extends Error {
  public constructor(cause: unknown) {
    super('Unexpected database operation failure', { cause })
    this.name = 'UnexpectedDatabaseOperationError'
  }
}

/**
 * Prisma persistence adapter for approval-request snapshots.
 *
 * @remarks
 * The terminal transition is a pending-only compare-and-set. Infrastructure
 * admission and explicit connectivity failures become stable unavailability;
 * other Prisma failures become safe unexpected adapter errors.
 */
@Injectable()
export class PrismaApprovalRequestRepository implements ApprovalRequestRepositoryPort {
  public constructor(private readonly provider: PrismaClientProvider) {}

  public async create(request: ApprovalRequest): Promise<ApprovalRequest> {
    const status = this.mapStatus(request.status)
    const createdAt = new Date(request.createdAt)
    const decidedAt =
      request.decidedAt === undefined ? null : new Date(request.decidedAt)
    const row = await this.runDatabaseOperation(() =>
      this.provider.withClient((client) =>
        client.approvalRequest.create({
          data: {
            id: request.id,
            title: request.title,
            description: request.description,
            status,
            createdByUserId: request.createdByUserId,
            decidedByUserId: request.decidedByUserId ?? null,
            createdAt,
            decidedAt,
          },
        }),
      ),
    )
    return mapPrismaApprovalRequest(row)
  }

  public async findById(id: string): Promise<ApprovalRequest | undefined> {
    const row = await this.runDatabaseOperation(() =>
      this.provider.withClient((client) =>
        client.approvalRequest.findUnique({ where: { id } }),
      ),
    )
    return row === null ? undefined : mapPrismaApprovalRequest(row)
  }

  public async decidePending(
    input: DecidePendingApprovalRequestInput,
  ): Promise<ApprovalRequest | undefined> {
    const status = input.decision === 'approved' ? 'APPROVED' : 'REJECTED'
    const decidedAt = new Date(input.decidedAt)
    const rows = await this.runDatabaseOperation(() =>
      this.provider.withClient((client) =>
        client.approvalRequest.updateManyAndReturn({
          where: { id: input.id, status: 'PENDING' },
          data: {
            status,
            decidedByUserId: input.decidedByUserId,
            decidedAt,
          },
        }),
      ),
    )
    if (rows.length === 0) return undefined
    if (rows.length !== 1) throw new DatabaseUnavailableError()
    return mapPrismaApprovalRequest(rows[0]!)
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
    } catch (error: unknown) {
      if (isDatabaseUnavailableFailure(error)) {
        throw new DatabaseUnavailableError()
      }
      throw new UnexpectedDatabaseOperationError(error)
    }
  }
}

function isDatabaseUnavailableFailure(error: unknown): boolean {
  if (error instanceof DatabaseUnavailableError) return true
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return databaseUnavailablePrismaCodes.has(error.code)
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return (
      error.errorCode !== undefined &&
      databaseUnavailablePrismaCodes.has(error.errorCode)
    )
  }
  return false
}
