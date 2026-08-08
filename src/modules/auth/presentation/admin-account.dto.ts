import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

const accountStates = ['invited', 'active', 'disabled', 'retired'] as const

export class AdminAccountPathDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  public accountId!: string
}

export class ListAdminAccountsQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page = 1

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 25 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  public pageSize = 25

  @ApiPropertyOptional({ type: String, maxLength: 254 })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  public search?: string

  @ApiPropertyOptional({ type: String, enum: accountStates })
  @IsOptional()
  @IsIn(accountStates)
  public state?: (typeof accountStates)[number]
}

export class UpdateAccountStatusRequestDto {
  @ApiProperty({ type: String, enum: ['active', 'disabled'] })
  @IsIn(['active', 'disabled'])
  public status!: 'active' | 'disabled'
}

export class ReplaceAccountRolesRequestDto {
  @ApiProperty({
    type: [String],
    maxItems: 50,
    example: ['system.admin'],
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u, { each: true })
  public roleKeys!: string[]
}

export class CreateAccountInvitationRequestDto extends ReplaceAccountRolesRequestDto {
  @ApiProperty({ type: String, format: 'email', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  public email!: string
}

export class AcceptAccountInvitationRequestDto {
  @ApiProperty({ type: String, minLength: 43, maxLength: 43 })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/u)
  @MaxLength(1024)
  public token!: string

  @ApiProperty({
    type: String,
    format: 'password',
    minLength: 12,
    maxLength: 1024,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(1024)
  public password!: string
}

export class AccountMailDeliveryResponseDto {
  @ApiProperty({ enum: ['delivered', 'failed'] })
  public readonly mailDelivery!: 'delivered' | 'failed'
}

export class AdminAccountResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  public readonly id!: string

  @ApiProperty({ type: String, format: 'email', nullable: true })
  public readonly email!: string | null

  @ApiProperty({ type: String, enum: accountStates })
  public readonly state!: (typeof accountStates)[number]

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  public readonly emailVerifiedAt!: Date | null

  @ApiProperty({ type: [String] })
  public readonly roleKeys!: readonly string[]

  @ApiProperty({ type: String, format: 'date-time' })
  public readonly createdAt!: Date

  @ApiProperty({ type: String, format: 'date-time' })
  public readonly updatedAt!: Date

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  public readonly retiredAt!: Date | null

  @ApiProperty({ type: Number, minimum: 0 })
  public readonly revision!: number
}

export class AdminAccountListResponseDto {
  @ApiProperty({ type: () => [AdminAccountResponseDto] })
  public readonly items!: readonly AdminAccountResponseDto[]

  @ApiProperty({ type: Number, minimum: 0 })
  public readonly total!: number
}

export class AdminRoleCatalogItemDto {
  @ApiProperty({ type: String })
  public readonly key!: string

  @ApiProperty({ type: [String] })
  public readonly permissions!: readonly string[]
}

export class AdminRoleCatalogResponseDto {
  @ApiProperty({ type: () => [AdminRoleCatalogItemDto] })
  public readonly roles!: readonly AdminRoleCatalogItemDto[]
}
