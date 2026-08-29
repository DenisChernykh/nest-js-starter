import { ApiProperty } from '@nestjs/swagger'
import { IsUUID } from 'class-validator'

export class AccountLifecyclePathDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  public accountId!: string
}
