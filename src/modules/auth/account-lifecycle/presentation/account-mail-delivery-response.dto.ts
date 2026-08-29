import { ApiProperty } from '@nestjs/swagger'

export class AccountMailDeliveryResponseDto {
  @ApiProperty({ enum: ['delivered', 'failed'] })
  public readonly mailDelivery!: 'delivered' | 'failed'
}
