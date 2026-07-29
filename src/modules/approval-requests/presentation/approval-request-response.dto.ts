import { ApiProperty } from '@nestjs/swagger'

import type { ApprovalRequestStatus } from '../domain/approval-request'

/** Complete public projection returned by approval-request operations. */
export class ApprovalRequestResponseDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    example: '8dc70a15-d91f-4c67-b5a6-479faa42433c',
  })
  public readonly id!: string

  @ApiProperty({ type: String, minLength: 1, maxLength: 120 })
  public readonly title!: string

  @ApiProperty({ type: String, minLength: 1, maxLength: 2_000 })
  public readonly description!: string

  @ApiProperty({ enum: ['pending', 'approved', 'rejected'] })
  public readonly status!: ApprovalRequestStatus

  @ApiProperty({ type: String, format: 'uuid' })
  public readonly createdByUserId!: string

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
  })
  public readonly decidedByUserId!: string | null

  @ApiProperty({ type: String, format: 'date-time' })
  public readonly createdAt!: Date

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  public readonly decidedAt!: Date | null
}
