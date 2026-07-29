import { Module } from '@nestjs/common'

import { DatabaseModule } from '@/platform/database/database.module'
import { PrismaClientProvider } from '@/platform/database/prisma-client.provider'
import { CreateApprovalRequestUseCase } from '../application/create-approval-request.use-case'
import { DecideApprovalRequestUseCase } from '../application/decide-approval-request.use-case'
import { GetApprovalRequestQuery } from '../application/get-approval-request.query'
import { PrismaApprovalRequestRepository } from '../infrastructure/prisma-approval-request.repository'
import { ApprovalRequestController } from '../presentation/approval-request.controller'

/** Explicit Nest composition for approval-request HTTP and persistence paths. */
@Module({
  imports: [DatabaseModule],
  controllers: [ApprovalRequestController],
  providers: [
    {
      provide: PrismaApprovalRequestRepository,
      inject: [PrismaClientProvider],
      useFactory: (
        provider: PrismaClientProvider,
      ): PrismaApprovalRequestRepository =>
        new PrismaApprovalRequestRepository(provider),
    },
    {
      provide: CreateApprovalRequestUseCase,
      inject: [PrismaApprovalRequestRepository],
      useFactory: (
        repository: PrismaApprovalRequestRepository,
      ): CreateApprovalRequestUseCase =>
        new CreateApprovalRequestUseCase(repository),
    },
    {
      provide: GetApprovalRequestQuery,
      inject: [PrismaApprovalRequestRepository],
      useFactory: (
        repository: PrismaApprovalRequestRepository,
      ): GetApprovalRequestQuery => new GetApprovalRequestQuery(repository),
    },
    {
      provide: DecideApprovalRequestUseCase,
      inject: [PrismaApprovalRequestRepository],
      useFactory: (
        repository: PrismaApprovalRequestRepository,
      ): DecideApprovalRequestUseCase =>
        new DecideApprovalRequestUseCase(repository),
    },
  ],
})
export class ApprovalRequestsModule {}
