import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches } from 'class-validator'

export class ConfirmEmailVerificationRequestDto {
  @ApiProperty({
    type: String,
    minLength: 43,
    maxLength: 43,
    pattern: '^[A-Za-z0-9_-]{43}$',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/u)
  public token!: string
}
