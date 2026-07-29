import { Transform } from 'class-transformer'
import { IsEnum, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

import type { ApprovalDecision } from '../domain/approval-request'

const trimStringEdges = ({ value }: { readonly value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

/** Validated and edge-trimmed content accepted for a new approval request. */
export class CreateApprovalRequestDto {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 120,
    example: 'Production access',
  })
  @Transform(trimStringEdges)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  public title!: string

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 2_000,
    example: 'Please approve production deployment access.',
  })
  @Transform(trimStringEdges)
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  public description!: string
}

/** Canonical UUID route path accepted by approval-request operations. */
export class ApprovalRequestPathDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    example: '8dc70a15-d91f-4c67-b5a6-479faa42433c',
  })
  @IsUUID('4')
  public requestId!: string
}

/** Finite terminal decision accepted for a pending approval request. */
export class DecideApprovalRequestDto {
  @ApiProperty({
    enum: ['approved', 'rejected'],
    example: 'approved',
  })
  @IsEnum(['approved', 'rejected'])
  public decision!: ApprovalDecision
}
