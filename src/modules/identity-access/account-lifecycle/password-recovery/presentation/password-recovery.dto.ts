import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class ConfirmPasswordResetRequestDto {
  @ApiProperty({
    type: String,
    minLength: 43,
    maxLength: 43,
    pattern: '^[A-Za-z0-9_-]{43}$',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/u)
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
  public newPassword!: string
}
